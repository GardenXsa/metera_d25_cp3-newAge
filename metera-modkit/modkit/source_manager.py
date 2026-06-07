"""Lifecycle for the local engine source tree.

The modkit agent (and its ``code_*`` tools) operate on a snapshot of
the public ``GardenXsa/metera_d25_cp3-newAge`` repository. Instead of
fetching that snapshot from the network on every agent run, the modkit
keeps a real local clone at :func:`modkit.paths.source_root` and treats
it as part of its own state.

Workflow
--------

* On first run the modkit prompts the user, then ``git clone``s the
  repo into ``<source_root>/<owner>__<repo>/`` (shallow, single
  branch, ~10–50 MB).
* On every subsequent run the modkit does ``git fetch`` and compares
  the local ``HEAD`` to ``origin/<branch>``. If behind, it asks the
  user to ``git reset --hard origin/<branch>``.
* If ``git`` is not on ``PATH`` (e.g. a modder without Git for
  Windows), the manager falls back to a tarball download — first from
  ``cdn.jsdelivr.net`` (Cloudflare CDN, often reachable when GitHub
  isn't), then from ``codeload.github.com``, then from
  ``github.com/<owner>/<repo>/archive/refs/heads/<branch>.tar.gz`` (the
  last one 302-redirects to codeload but the manager tries it anyway
  in case the redirect target is on a different block list).

The modkit itself only ever **reads** from the local tree; this
manager is the only module that writes to it.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from modkit.ssl_helpers import ssl_context as _ssl_context


# Public source defaults — also the only place the modkit says
# "where does the engine come from" out loud.
DEFAULT_OWNER = "GardenXsa"
DEFAULT_REPO = "metera_d25_cp3-newAge"
DEFAULT_BRANCH = "master"

CLONE_URL_TEMPLATE = "https://github.com/{owner}/{repo}.git"
ARCHIVE_URL_FALLBACKS: tuple[str, ...] = (
    # jsDelivr serves a tarball when called as a single-archive URL.
    "https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}.tar.gz",
    # codeload serves the canonical tarball. Works in many envs.
    "https://codeload.github.com/{owner}/{repo}/tar.gz/refs/heads/{branch}",
    # github.com redirects to codeload for /archive URLs. Listed last
    # because it depends on codeload being reachable; jsDelivr above is
    # the reliable one when codeload is blocked.
    "https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.tar.gz",
)

GIT_TIMEOUT_CLONE = 600
GIT_TIMEOUT_FETCH = 120
GIT_TIMEOUT_RESET = 60
ARCHIVE_TIMEOUT = 180
ARCHIVE_MIN_BYTES = 64  # sanity floor — empty body is treated as failure

# Callbacks — injected from CLI / GUI so the same code works in both.
ProgressCB = Optional[Callable[[str], None]]
PromptCB = Optional[Callable[[str, str], bool]]  # (title, message) -> True/False


@dataclass(frozen=True)
class SourceSpec:
    """Identity of one upstream repo we want a local copy of."""

    owner: str
    repo: str
    branch: str

    @property
    def dir_name(self) -> str:
        return f"{self.owner}__{self.repo}"

    @property
    def clone_url(self) -> str:
        return CLONE_URL_TEMPLATE.format(owner=self.owner, repo=self.repo)

    @property
    def display_name(self) -> str:
        return f"{self.owner}/{self.repo}@{self.branch}"

    def archive_urls(self) -> list[str]:
        return [
            tpl.format(owner=self.owner, repo=self.repo, branch=self.branch)
            for tpl in ARCHIVE_URL_FALLBACKS
        ]


class SourceError(RuntimeError):
    """Raised when a source operation fails in a way the caller should surface."""


class SourceManager:
    """Owns the local clone of one (or several) repos.

    Cheap to construct; one instance per :func:`modkit.paths.source_root`
    is the typical usage. All public methods are thread-safe only at
    the per-call level — concurrent calls on the same ``SourceManager``
    can race on the same target directory.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    # ── introspection ────────────────────────────────────────────────

    def dir_for(self, spec: SourceSpec) -> Path:
        return self.root / spec.dir_name

    def is_cloned(self, spec: SourceSpec) -> bool:
        d = self.dir_for(spec)
        return d.is_dir() and (d / ".git").exists()

    def current_sha(self, spec: SourceSpec) -> str | None:
        if not self.is_cloned(spec):
            return None
        try:
            return self._git(spec, "rev-parse", "HEAD")
        except SourceError:
            return None

    def remote_sha(self, spec: SourceSpec) -> str | None:
        if not self.is_cloned(spec):
            return None
        try:
            self._git(spec, "fetch", "--depth", "1", "origin", spec.branch)
            return self._git(spec, "rev-parse", f"origin/{spec.branch}")
        except SourceError:
            return None

    def is_up_to_date(self, spec: SourceSpec) -> bool:
        local = self.current_sha(spec)
        remote = self.remote_sha(spec)
        return bool(local) and local == remote

    def has_updates(self, spec: SourceSpec) -> bool:
        local = self.current_sha(spec)
        remote = self.remote_sha(spec)
        return bool(local and remote) and local != remote

    # ── public entry point ───────────────────────────────────────────

    def ensure_ready(
        self,
        spec: SourceSpec,
        *,
        update: bool = True,
        prompt: PromptCB = None,
        progress: ProgressCB = None,
        allow_fallback: bool = True,
    ) -> bool:
        """Clone if missing, update if behind. Returns ``True`` when the
        tree is usable (cloned; current if ``update=True``).

        ``prompt`` is called with ``(title, body)`` and must return
        ``True`` to proceed, ``False`` to skip the step. ``None`` means
        "auto-yes" (used in non-interactive / scripted runs).
        """
        d = self.dir_for(spec)

        # 1) First-run clone
        if not self.is_cloned(spec):
            if prompt and not prompt(
                "Скачать исходники движка?",
                f"{spec.display_name} не найден в:\n  {d}\n\n"
                f"Скачать (~10–50 МБ) сейчас?",
            ):
                return False
            self._log(progress, f"клонирую {spec.clone_url} ...")
            self._clone_git(spec, progress=progress, allow_fallback=allow_fallback)
            return True

        # 2) Optional update
        if not update:
            return True

        self._log(progress, f"проверяю обновления {spec.display_name} ...")
        local = self.current_sha(spec)
        try:
            self._git(spec, "fetch", "--depth", "1", "origin", spec.branch)
        except SourceError as exc:
            self._log(progress, f"git fetch не удался ({exc}); пробую tarball")
            self._download_archive_into(spec, d, progress=progress)
            return True
        remote = self.remote_sha(spec) or local
        if not local or local == remote:
            return True

        if prompt and not prompt(
            "Обновить исходники движка?",
            f"Локально:  {local[:10]}\n"
            f"Удалённо: {remote[:10]}\n\n"
            f"Обновить?",
        ):
            return True
        self._log(progress, f"обновляю {spec.display_name} ...")
        self._update_git(spec)
        return True

    # ── private: git plumbing ────────────────────────────────────────

    def _git(self, spec: SourceSpec, *args: str) -> str:
        d = self.dir_for(spec)
        try:
            out = subprocess.run(
                ["git", "-C", str(d), *args],
                check=True,
                capture_output=True,
                text=True,
                timeout=GIT_TIMEOUT_FETCH,
            )
        except FileNotFoundError as exc:
            raise SourceError("git не найден в PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise SourceError(f"git timeout: {args[0]}") from exc
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or "").strip()
            raise SourceError(f"git {' '.join(args)}: {err or exc}") from exc
        return out.stdout.strip()

    def _clone_git(
        self,
        spec: SourceSpec,
        *,
        progress: ProgressCB = None,
        allow_fallback: bool = True,
    ) -> None:
        d = self.dir_for(spec)
        if d.exists():
            shutil.rmtree(d)
        d.parent.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--depth", "1",
                    "--branch", spec.branch,
                    "--single-branch",
                    spec.clone_url,
                    str(d),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=GIT_TIMEOUT_CLONE,
            )
            return
        except FileNotFoundError as exc:
            err = "git не найден в PATH"
        except subprocess.TimeoutExpired as exc:
            err = f"git clone timeout: {exc}"
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or "").strip() or str(exc)
        self._log(progress, f"git clone не удался: {err}")
        if not allow_fallback:
            raise SourceError(f"git clone {spec.clone_url}: {err}")
        self._download_archive_into(spec, d, progress=progress)

    def _update_git(self, spec: SourceSpec) -> None:
        d = self.dir_for(spec)
        try:
            subprocess.run(
                ["git", "-C", str(d), "fetch", "--depth", "1", "origin", spec.branch],
                check=True, capture_output=True, text=True, timeout=GIT_TIMEOUT_FETCH,
            )
            subprocess.run(
                ["git", "-C", str(d), "reset", "--hard", f"origin/{spec.branch}"],
                check=True, capture_output=True, text=True, timeout=GIT_TIMEOUT_RESET,
            )
        except FileNotFoundError as exc:
            raise SourceError("git не найден в PATH") from exc
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or "").strip() or str(exc)
            raise SourceError(f"git update {spec.display_name}: {err}") from exc

    # ── private: tarball fallback ────────────────────────────────────

    def _download_archive_into(
        self,
        spec: SourceSpec,
        dest: Path,
        *,
        progress: ProgressCB = None,
    ) -> None:
        """Download a tarball and unpack it into *dest*. No git required."""
        last_err: str = ""
        for url in spec.archive_urls():
            self._log(progress, f"пробую {url}")
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "metera-modkit"}
                )
                with urllib.request.urlopen(
                    req, timeout=ARCHIVE_TIMEOUT, context=_ssl_context()
                ) as resp:
                    data = resp.read()
            except (urllib.error.URLError, OSError) as exc:
                last_err = f"{type(exc).__name__}: {exc}"
                continue
            if len(data) < ARCHIVE_MIN_BYTES:
                last_err = f"empty body ({len(data)} bytes) from {url}"
                continue
            try:
                self._extract_tarball(data, dest)
                return
            except (tarfile.TarError, OSError) as exc:
                last_err = f"extract failed: {type(exc).__name__}: {exc}"
                continue
        raise SourceError(
            f"не удалось скачать архив {spec.display_name}: {last_err}"
        )

    def _extract_tarball(self, data: bytes, dest: Path) -> None:
        """Unpack a GitHub-style tarball (``<owner>-<repo>-<sha>/...``)
        into *dest*, skipping symlinks and refusing path traversal."""
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)

        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            members = []
            for m in tf.getmembers():
                if m.issym() or m.islnk() or m.ischr() or m.isblk() or m.isfifo():
                    continue  # symlinks/hardlinks/devices: not in a source tarball
                if m.name.startswith(("/", "../")) or "/../" in ("/" + m.name):
                    continue  # path traversal guard
                members.append(m)
            if not members:
                raise tarfile.TarError("archive has no usable entries")
            # GitHub tarballs use a single top-level dir; the extract
            # below puts it next to ``dest``, then we flatten one level.
            staging = dest.parent / (dest.name + ".__staging__")
            if staging.exists():
                shutil.rmtree(staging)
            tf.extractall(path=staging, members=members)

        # Flatten: if the staging has exactly one directory child, move
        # *its* children into ``dest`` (this is the GitHub-tarball
        # shape: ``<owner>-<repo>-<sha>/foo/...`` → ``dest/foo/...``).
        # Otherwise move the children as-is.
        dest.mkdir(parents=True, exist_ok=True)
        children = list(staging.iterdir())
        if len(children) == 1 and children[0].is_dir():
            for inner in children[0].iterdir():
                shutil.move(str(inner), str(dest / inner.name))
        else:
            for child in children:
                shutil.move(str(child), str(dest / child.name))
        shutil.rmtree(staging)

    # ── util ─────────────────────────────────────────────────────────

    @staticmethod
    def _log(progress: ProgressCB, msg: str) -> None:
        if progress:
            try:
                progress(msg)
            except Exception:
                pass


# ── module-level convenience ────────────────────────────────────────

_DEFAULT_SPEC = SourceSpec(DEFAULT_OWNER, DEFAULT_REPO, DEFAULT_BRANCH)


def default_spec() -> SourceSpec:
    """The hard-coded engine repo the modkit ships with."""
    return _DEFAULT_SPEC


def default_manager() -> SourceManager:
    """One ``SourceManager`` rooted at :func:`modkit.paths.source_root`."""
    from modkit.paths import source_root  # local import to avoid cycles
    return SourceManager(source_root())

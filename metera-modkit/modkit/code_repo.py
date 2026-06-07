"""Read-only view of the local engine source tree.

The modkit agent (and its ``code_*`` tools) operate on a snapshot of
the public ``GardenXsa/metera_d25_cp3-newAge`` repository. That
snapshot is cloned to disk by :mod:`modkit.source_manager` on first
run and kept in sync by ``git fetch``/``git reset``. This module is the
read side: it walks a local directory, indexes the files, and serves
their contents on demand.

No network code lives in this module. If the source tree is missing,
the snapshot is empty and every method that needs a file returns
``None`` / ``[]`` with a clear error — the caller (CLI / GUI) is
responsible for prompting the user to run :func:`modkit.source_manager
.SourceManager.ensure_ready` first.

Pipeline
--------

1. :func:`default` builds a :class:`CodeRepo` pointed at the directory
   the source manager uses (``<source_root>/<owner>__<repo>/``). It
   *does not* trigger a clone — that's a separate, promptable
   operation owned by :class:`SourceManager`.
2. :meth:`ensure_loaded` walks the directory once and caches the list
   of file paths. File *contents* are read on demand and cached in
   :attr:`files`.
3. Every other method (``get_file``, ``list_dir``, ``tree``,
   ``find_files``, ``grep``, ``outline``, ...) works on the cached
   paths + on-demand contents.
"""

from __future__ import annotations

import ast
import fnmatch
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


# Public defaults are mirrored from modkit.source_manager so tests and
# the agent prompt text stay in sync.
DEFAULT_OWNER = "GardenXsa"
DEFAULT_REPO = "metera_d25_cp3-newAge"
DEFAULT_BRANCH = "master"


@dataclass
class CodeRepo:
    """One in-memory index over a local source tree.

    The directory at :attr:`source_dir` is walked lazily by
    :meth:`ensure_loaded`. File contents are read on demand and cached
    in :attr:`files` so the second call is instant.

    Use :func:`default` to get a process-wide singleton pointed at the
    user's local clone; tests should construct their own with a
    ``tmp_path`` fixture.
    """

    source_dir: Path
    owner: str = ""
    repo: str = ""
    branch: str = ""
    source_url: str = ""
    files: dict[str, bytes] = field(default_factory=dict)
    file_paths: list[str] = field(default_factory=list)
    loaded: bool = False
    load_error: str = ""

    def __post_init__(self) -> None:
        if not self.source_url and self.owner and self.repo:
            self.source_url = (
                f"https://github.com/{self.owner}/{self.repo}/tree/{self.branch}"
            )
        if isinstance(self.source_dir, str):
            self.source_dir = Path(self.source_dir)

    # ── introspection ────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        return bool(self.source_dir) and self.source_dir.is_dir()

    def is_present(self) -> bool:
        """True when the source directory looks like a real checkout."""
        if not self.available:
            return False
        return any(self.source_dir.iterdir()) if self.source_dir.exists() else False

    # ── loading ──────────────────────────────────────────────────────

    def ensure_loaded(self) -> None:
        """Walk :attr:`source_dir` once. Idempotent.

        Populates :attr:`file_paths` (a sorted list of relative POSIX
        paths) and sets :attr:`loaded`. Populates :attr:`load_error`
        on failure but never raises — callers should check
        :attr:`loaded` or the returned ``info()`` dict.
        """
        if self.loaded:
            return
        if not self.available:
            self.load_error = f"source dir not found: {self.source_dir}"
            return
        paths: list[str] = []
        try:
            for root, _dirs, files in os.walk(self.source_dir):
                # Skip the .git directory — it's not source.
                rel_root = Path(root).relative_to(self.source_dir).as_posix()
                if rel_root == ".git" or rel_root.startswith(".git/"):
                    continue
                for name in files:
                    full = Path(root) / name
                    rel = full.relative_to(self.source_dir).as_posix()
                    if rel.startswith(".git/"):
                        continue
                    paths.append(rel)
        except OSError as exc:
            self.load_error = f"walk failed: {type(exc).__name__}: {exc}"
            return
        self.file_paths = sorted(paths)
        self.loaded = True

    def reset(self) -> None:
        """Wipe the index. Tests use this; nobody else should."""
        self.files.clear()
        self.file_paths = []
        self.loaded = False
        self.load_error = ""

    # ── single file access ───────────────────────────────────────────

    def get_file(self, path: str) -> bytes | None:
        """Return the raw bytes of *path* in the repo, or ``None``."""
        path = _norm_path(path)
        if not path:
            return None
        if path in self.files:
            return self.files[path]
        full = self.source_dir / path
        if not full.is_file():
            return None
        try:
            data = full.read_bytes()
        except OSError:
            return None
        self.files[path] = data
        return data

    def has_file(self, path: str) -> bool:
        path = _norm_path(path)
        if not path:
            return False
        if path in self.files:
            return True
        if not self.loaded:
            self.ensure_loaded()
        return path in self.file_paths

    # ── summary / navigation ─────────────────────────────────────────

    def info(self) -> dict[str, Any]:
        if not self.loaded:
            self.ensure_loaded()
        total_bytes = 0
        by_ext: dict[str, int] = {}
        top_dirs: set[str] = set()
        for rel in self.file_paths:
            ext = _ext_of(rel)
            by_ext[ext] = by_ext.get(ext, 0) + 1
            top = rel.split("/", 1)[0]
            top_dirs.add(top)
            if rel in self.files:
                total_bytes += len(self.files[rel])
        return {
            "owner": self.owner,
            "repo": self.repo,
            "branch": self.branch,
            "source": self.source_url,
            "source_dir": str(self.source_dir),
            "loaded": self.loaded,
            "available": self.available,
            "load_error": self.load_error,
            "total_files": len(self.file_paths),
            "total_bytes": total_bytes,
            "top_level_dirs": sorted(top_dirs),
            "by_extension": dict(sorted(by_ext.items(), key=lambda kv: (-kv[1], kv[0]))),
        }

    def list_dir(self, path: str = "") -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        prefix = _norm_path(path)
        if prefix:
            prefix = prefix + "/"
        seen: dict[str, dict[str, Any]] = {}
        for full in self.file_paths:
            if not full.startswith(prefix):
                continue
            tail = full[len(prefix):]
            if not tail:
                continue
            if "/" in tail:
                d = tail.split("/", 1)[0]
                key = d + "/"
                entry = seen.setdefault(
                    key, {"name": d, "type": "dir", "size": 0}
                )
            else:
                size = len(self.files[full]) if full in self.files else 0
                entry = seen.setdefault(
                    tail, {"name": tail, "type": "file", "size": size}
                )
        return sorted(seen.values(), key=lambda e: (e["type"] == "file", e["name"].lower()))

    def tree(self, path: str = "", max_entries: int = 5000) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        prefix = _norm_path(path)
        if prefix:
            prefix = prefix + "/"
        emitted_dirs: set[str] = set()
        out: list[dict[str, Any]] = []
        for full in self.file_paths:
            if not full.startswith(prefix):
                continue
            tail = full[len(prefix):]
            if not tail:
                continue
            parts = tail.split("/")
            for i in range(1, len(parts)):
                dir_path = (prefix + "/".join(parts[:i])) if prefix else "/".join(parts[:i])
                if dir_path in emitted_dirs:
                    continue
                emitted_dirs.add(dir_path)
                out.append({"path": dir_path, "type": "dir", "depth": i})
                if len(out) >= max_entries:
                    return out
            out.append(
                {
                    "path": full,
                    "type": "file",
                    "depth": len(parts) - 1,
                    "size": len(self.files[full]) if full in self.files else 0,
                }
            )
            if len(out) >= max_entries:
                break
        return out

    def find_files(self, glob: str, max_results: int = 200) -> list[str]:
        if not self.loaded:
            self.ensure_loaded()
        if not glob:
            return []
        out: list[str] = []
        for path in self.file_paths:
            if fnmatch.fnmatch(path, glob) or fnmatch.fnmatch(_basename(path), glob):
                out.append(path)
                if len(out) >= max_results:
                    break
        return out

    # ── search / outline / deps ──────────────────────────────────────

    def grep(
        self,
        pattern: str,
        path_glob: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        if not pattern:
            return []
        try:
            regex = re.compile(pattern)
        except re.error as exc:
            return [{"_error": f"invalid regex: {exc}"}]
        out: list[dict[str, Any]] = []
        for path in self.file_paths:
            if path_glob and not (
                fnmatch.fnmatch(path, path_glob)
                or fnmatch.fnmatch(_basename(path), path_glob)
            ):
                continue
            data = self.get_file(path)
            if data is None:
                continue
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                continue
            for line_no, line in enumerate(text.splitlines(), 1):
                if regex.search(line):
                    out.append(
                        {
                            "path": path,
                            "line": line_no,
                            "text": line,
                        }
                    )
        return out

    def where_defined(self, symbol: str) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        if not symbol:
            return []
        ident = re.escape(symbol)
        patterns: list[tuple[re.Pattern[str], str]] = [
            (re.compile(rf"^(?:function|const|let|var|class)\s+(?P<name>{ident})\b"), "js"),
            (re.compile(rf"^(?:def|class)\s+(?P<name>{ident})\b"), "py"),
            (re.compile(rf"^(?:struct|class|enum|union)\s+(?P<name>{ident})\b"), "cpp"),
            (
                re.compile(
                    rf"^(?:static|inline|virtual|constexpr|explicit|extern|template\s*<[^>]*>\s*)*"
                    rf"[\w:<>*&\s]+?\s+(?P<name>{ident})\s*\("
                ),
                "cpp",
            ),
            (
                re.compile(rf"^(?:export\s+)?(?:async\s+)?function\s+(?P<name>{ident})\b"),
                "js",
            ),
            (re.compile(rf"^(?:MeteraPlugin_|Metera_)\w*(?P<name>{ident})\b"), "cpp"),
        ]
        out: list[dict[str, Any]] = []
        for path in self.file_paths:
            data = self.get_file(path)
            if data is None:
                continue
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                continue
            for line_no, line in enumerate(text.splitlines(), 1):
                for pat, family in patterns:
                    m = pat.search(line)
                    if not m:
                        continue
                    name = m.groupdict().get("name") or symbol
                    out.append(
                        {
                            "path": path,
                            "line": line_no,
                            "text": line,
                            "name": name,
                            "kind": _classify_def(line),
                        }
                    )
                    break
        return out

    def references(self, symbol: str, path_glob: str | None = None) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        if not symbol:
            return []
        ident = re.escape(symbol)
        pat = re.compile(rf"\b{ident}\b")
        def_pats = self._def_patterns(symbol)
        out: list[dict[str, Any]] = []
        for path in self.file_paths:
            if path_glob and not (
                fnmatch.fnmatch(path, path_glob)
                or fnmatch.fnmatch(_basename(path), path_glob)
            ):
                continue
            data = self.get_file(path)
            if data is None:
                continue
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                continue
            for line_no, line in enumerate(text.splitlines(), 1):
                if not pat.search(line):
                    continue
                is_def = any(p.search(line) for p in def_pats)
                out.append(
                    {
                        "path": path,
                        "line": line_no,
                        "text": line,
                        "is_definition": is_def,
                    }
                )
        return out

    def dependencies(self, file: str) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        file = _norm_path(file)
        data = self.files.get(file) or self.get_file(file)
        if data is None:
            return []
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            return []
        return _extract_includes(file, text)

    def dependents(self, file: str) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        file = _norm_path(file)
        if not file:
            return []
        aliases = _dep_aliases(file)
        out: list[dict[str, Any]] = []
        for path in self.file_paths:
            if path == file:
                continue
            data = self.get_file(path)
            if data is None:
                continue
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                continue
            for line_no, line in enumerate(text.splitlines(), 1):
                stripped = line.lstrip()
                if not stripped:
                    continue
                if stripped.startswith(("//", "/*", "*", "<!--")):
                    continue
                for needle in aliases:
                    if needle and needle in line:
                        out.append(
                            {
                                "path": path,
                                "line": line_no,
                                "text": line,
                                "matched": needle,
                            }
                        )
                        break
        return out

    # ── helpers used by tools ───────────────────────────────────────

    def read_text(self, path: str) -> tuple[str, dict[str, Any]] | None:
        path = _norm_path(path)
        if not path:
            return None
        data = self.files.get(path) or self.get_file(path)
        if data is None:
            return None
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            return None
        meta = {
            "path": path,
            "bytes": len(data),
            "lines": text.count("\n") + (0 if text.endswith("\n") else 1),
            "source": "local",
        }
        return text, meta

    def count_lines(self, path: str) -> dict[str, Any] | None:
        path = _norm_path(path)
        if not path:
            return None
        data = self.files.get(path) or self.get_file(path)
        if data is None:
            return None
        text = data.decode("utf-8", errors="replace")
        return {
            "path": path,
            "total_lines": text.count("\n") + (0 if text.endswith("\n") else 1),
            "total_bytes": len(data),
            "language": _ext_to_language(path),
        }

    def outline(self, file: str | None = None) -> list[dict[str, Any]]:
        if not self.loaded:
            self.ensure_loaded()
        out: list[dict[str, Any]] = []
        targets: Iterable[tuple[str, bytes]]
        if file:
            file = _norm_path(file)
            data = self.files.get(file) or self.get_file(file)
            targets = [(file, data)] if data is not None else []
        else:
            targets = [(p, self.get_file(p)) for p in self.file_paths]
        for path, data in targets:
            if data is None:
                continue
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                continue
            out.extend(_outline_file(path, text))
        return out

    # ── internal ─────────────────────────────────────────────────────

    def _def_patterns(self, symbol: str) -> list[re.Pattern[str]]:
        ident = re.escape(symbol)
        return [
            re.compile(rf"^(?:function|const|let|var|class)\s+{ident}\b"),
            re.compile(rf"^(?:def|class)\s+{ident}\b"),
            re.compile(rf"^(?:struct|class|enum|union)\s+{ident}\b"),
            re.compile(rf"^(?:static|inline|virtual|constexpr|explicit|extern|template\s*<[^>]*>\s+)*[\w:<>*&\s]+?\s+{ident}\s*\("),
            re.compile(rf"^(?:export\s+)?(?:async\s+)?function\s+{ident}\b"),
        ]


# ── singleton + helpers ──────────────────────────────────────────────


_default_lock = None  # lazy: ``threading.Lock`` is created on first use
_default: CodeRepo | None = None


def _default_lock_lazy():
    global _default_lock
    if _default_lock is None:
        import threading
        _default_lock = threading.Lock()
    return _default_lock


def _resolve_source_dir() -> Path:
    """Where the user's local clone of the engine source lives.

    Delegates to :mod:`modkit.source_manager` so that ``default()``
    stays a thin wrapper and the actual location policy lives in one
    place.
    """
    from modkit.source_manager import default_manager, default_spec
    return default_manager().dir_for(default_spec())


def default() -> CodeRepo:
    """Return a process-wide singleton pointed at the local source tree.

    Does *not* clone or update — see :func:`modkit.source_manager
    .SourceManager.ensure_ready`. The returned object reflects whatever
    is on disk; if the tree is empty / missing, ``info()`` and friends
    report that and the agent should instruct the user to clone.
    """
    global _default
    if _default is None:
        with _default_lock_lazy():
            if _default is None:
                from modkit.source_manager import default_spec
                spec = default_spec()
                _default = CodeRepo(
                    source_dir=_resolve_source_dir(),
                    owner=spec.owner,
                    repo=spec.repo,
                    branch=spec.branch,
                )
    return _default


def set_default_repo(owner: str, repo: str, branch: str) -> None:
    """Point :func:`default` at a different local source tree.

    The tree is expected to already exist on disk; if it doesn't, every
    method call will return empty / None until the user (or a startup
    hook) populates it.
    """
    global _default
    with _default_lock_lazy():
        from modkit.source_manager import SourceManager
        from modkit.paths import source_root
        sm = SourceManager(source_root())
        # ``SourceSpec`` is a frozen dataclass, build it inline.
        from modkit.source_manager import SourceSpec
        spec = SourceSpec(owner, repo, branch)
        _default = CodeRepo(
            source_dir=sm.dir_for(spec),
            owner=owner,
            repo=repo,
            branch=branch,
        )


def _for_test(source_dir: Path) -> CodeRepo:
    """One-off repo for unit tests. ``source_dir`` is a tmp path.

    Unlike the old ``_for_test(owner, repo, branch)`` helper, this
    takes a real directory so tests can populate it with synthetic
    files and walk them through the same code path production uses.
    """
    return CodeRepo(source_dir=Path(source_dir))


# ── path / text utilities ────────────────────────────────────────────


def _norm_path(path: str) -> str:
    if not path:
        return ""
    p = str(path).replace("\\", "/").lstrip("/")
    if ".." in p.split("/"):
        return ""
    return p


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _ext_of(path: str) -> str:
    name = _basename(path)
    if "." not in name:
        return "(none)"
    return "." + name.rsplit(".", 1)[-1].lower()


def _ext_to_language(path: str) -> str:
    ext = _ext_of(path).lstrip(".")
    return {
        "cpp": "cpp",
        "cc": "cpp",
        "cxx": "cpp",
        "c": "c",
        "h": "cpp",
        "hpp": "cpp",
        "hxx": "cpp",
        "js": "javascript",
        "mjs": "javascript",
        "cjs": "javascript",
        "ts": "typescript",
        "py": "python",
        "json": "json",
        "md": "markdown",
        "txt": "text",
    }.get(ext, ext)


# ── outline extraction ───────────────────────────────────────────────


_JS_FUNC = re.compile(
    r"^(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\("
)
_JS_ARROW = re.compile(
    r"^(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\("
)
_JS_CLASS = re.compile(r"^(?:export\s+)?class\s+(?P<name>[A-Za-z_$][\w$]*)\b")
_JS_METHOD = re.compile(
    r"^\s+(?:static\s+|async\s+|get\s+|set\s+)*(?P<name>[A-Za-z_$][\w$]*)\s*\("
)

_CPP_SIG = re.compile(
    r"^(?:template\s*<[^>]*>\s*)?"
    r"(?:static\s+|virtual\s+|inline\s+|constexpr\s+|explicit\s+|extern\s+|const\s+)*"
    r"[\w:<>*&\s]+?\s+"
    r"(?P<name>[A-Za-z_]\w*)\s*"
    r"\([^;{}]*\)\s*(?:const)?\s*[;{]"
)
_CPP_CLASS = re.compile(r"^(?:template\s*<[^>]*>\s*)?(?:class|struct|enum(?:\s+class)?|union)\s+(?P<name>[A-Za-z_]\w*)\b")
_CPP_MEMBER = re.compile(
    r"^\s+(?:static\s+|virtual\s+|inline\s+|constexpr\s+|explicit\s+)*"
    r"[\w:<>*&\s]+?\s+"
    r"(?P<name>[A-Za-z_]\w*)\s*"
    r"\([^;{}]*\)\s*(?:const)?\s*[;{]"
)

_PY_DEF = re.compile(r"^(?:async\s+)?def\s+(?P<name>[A-Za-z_]\w*)\s*\(")
_PY_CLASS = re.compile(r"^class\s+(?P<name>[A-Za-z_]\w*)\b")
_PY_METHOD = re.compile(r"^\s+(?:async\s+)?def\s+(?P<name>[A-Za-z_]\w*)\s*\(")

_JSON_KEY = re.compile(r'^\s*"(?P<name>[^"]+)"\s*:\s*[{\[]')
_MD_HEADING = re.compile(r"^(#{1,6})\s+(?P<title>.+?)\s*$")


def _outline_file(path: str, text: str) -> list[dict[str, Any]]:
    ext = _ext_of(path).lstrip(".")
    lines = text.splitlines()
    out: list[dict[str, Any]] = []
    if ext in ("cpp", "c", "h", "hpp", "cc", "cxx", "hxx"):
        out.extend(_outline_cpp(path, lines))
    elif ext in ("js", "mjs", "cjs", "ts"):
        out.extend(_outline_js(path, lines))
    elif ext == "py":
        out.extend(_outline_py(path, lines))
    elif ext == "json":
        out.extend(_outline_json(path, lines))
    elif ext == "md":
        out.extend(_outline_md(path, lines))
    return out


def _outline_cpp(path: str, lines: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    in_class: str | None = None
    brace_depth = 0
    for i, line in enumerate(lines, 1):
        stripped = line.lstrip()
        if not stripped or stripped.startswith("//"):
            continue
        m = _CPP_CLASS.match(line)
        if m:
            out.append(
                {
                    "path": path,
                    "line": i,
                    "name": m.group("name"),
                    "kind": "class",
                    "signature": line.rstrip(),
                    "language": "cpp",
                }
            )
            in_class = m.group("name")
        else:
            m = _CPP_SIG.match(line) or _CPP_MEMBER.match(line)
            if m:
                kind = (
                    "method"
                    if in_class and brace_depth > 0 and line.startswith("    ")
                    else "function"
                )
                out.append(
                    {
                        "path": path,
                        "line": i,
                        "name": m.group("name"),
                        "kind": kind,
                        "signature": line.rstrip(),
                        "language": "cpp",
                    }
                )
        brace_depth += line.count("{") - line.count("}")
        if brace_depth <= 0:
            in_class = None
    return out


def _outline_js(path: str, lines: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    in_class: str | None = None
    brace_depth = 0
    for i, line in enumerate(lines, 1):
        stripped = line.lstrip()
        if not stripped or stripped.startswith("//"):
            continue
        m = _JS_CLASS.match(line)
        if m:
            out.append(
                {
                    "path": path,
                    "line": i,
                    "name": m.group("name"),
                    "kind": "class",
                    "signature": line.rstrip(),
                    "language": "javascript",
                }
            )
            in_class = m.group("name")
        else:
            m = _JS_FUNC.match(line) or _JS_ARROW.match(line)
            if m:
                out.append(
                    {
                        "path": path,
                        "line": i,
                        "name": m.group("name"),
                        "kind": "function",
                        "signature": line.rstrip(),
                        "language": "javascript",
                    }
                )
            elif in_class and brace_depth > 0 and line.startswith("    "):
                m2 = _JS_METHOD.match(line)
                if m2:
                    out.append(
                        {
                            "path": path,
                            "line": i,
                            "name": m2.group("name"),
                            "kind": "method",
                            "signature": line.rstrip(),
                            "language": "javascript",
                        }
                    )
        brace_depth += line.count("{") - line.count("}")
        if brace_depth <= 0:
            in_class = None
    return out


def _outline_py(path: str, lines: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    src = "\n".join(lines)
    try:
        tree = ast.parse(src)
    except (SyntaxError, ValueError):
        return out

    def visit(node: ast.AST, in_class: str | None) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                out.append(
                    {
                        "path": path,
                        "line": child.lineno,
                        "name": child.name,
                        "kind": "class",
                        "signature": f"class {child.name}",
                        "language": "python",
                    }
                )
                visit(child, child.name)
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                kind = "method" if in_class else "function"
                out.append(
                    {
                        "path": path,
                        "line": child.lineno,
                        "name": child.name,
                        "kind": kind,
                        "signature": _py_signature(child),
                        "language": "python",
                    }
                )
                visit(child, in_class)
            else:
                visit(child, in_class)

    visit(tree, None)
    return out


def _py_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    args: list[str] = []
    posargs = getattr(node.args, "posonlyargs", []) + node.args.args
    for a in posargs:
        args.append(a.arg)
    if node.args.vararg:
        args.append("*" + node.args.vararg.arg)
    for a in node.args.kwonlyargs:
        args.append(a.arg)
    if node.args.kwarg:
        args.append("**" + node.args.kwarg.arg)
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    return f"{prefix} {node.name}({', '.join(args)})"


def _outline_json(path: str, lines: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, line in enumerate(lines, 1):
        m = _JSON_KEY.match(line)
        if m:
            out.append(
                {
                    "path": path,
                    "line": i,
                    "name": m.group("name"),
                    "kind": "key",
                    "signature": line.rstrip(),
                    "language": "json",
                }
            )
    return out


def _outline_md(path: str, lines: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, line in enumerate(lines, 1):
        m = _MD_HEADING.match(line)
        if m:
            out.append(
                {
                    "path": path,
                    "line": i,
                    "name": m.group("title"),
                    "kind": "heading",
                    "signature": line.rstrip(),
                    "language": "markdown",
                }
            )
    return out


def _classify_def(line: str) -> str:
    s = line.lstrip()
    if s.startswith("def ") or s.startswith("async def "):
        return "function"
    if s.startswith("class "):
        return "class"
    if s.startswith("function ") or "= (" in s or "=>" in s:
        return "function"
    if "struct " in s.split("(")[0]:
        return "struct"
    return "function"


# ── include / import extraction ─────────────────────────────────────


_CPP_INCLUDE = re.compile(r'^\s*#\s*include\s*[<"](?P<path>[^>"]+)[>"]')
_JS_IMPORT = re.compile(r"""^\s*import\s+(?:.+?\s+from\s+)?['"](?P<path>[^'"]+)['"]""")
_JS_REQUIRE = re.compile(r"""require\(\s*['"](?P<path>[^'"]+)['"]\s*\)""")
_PY_IMPORT = re.compile(r"^\s*from\s+(?P<path>[\w.]+)\s+import\b")
_PY_IMPORT2 = re.compile(r"^\s*import\s+(?P<path>[\w.]+)(?:\s+as\s+\w+)?\s*$")


def _extract_includes(file: str, text: str) -> list[dict[str, Any]]:
    ext = _ext_of(file).lstrip(".")
    out: list[dict[str, Any]] = []
    for i, line in enumerate(text.splitlines(), 1):
        if ext in ("cpp", "c", "h", "hpp", "cc", "cxx", "hxx"):
            m = _CPP_INCLUDE.match(line)
            if m:
                out.append({"path": file, "line": i, "target": m.group("path"), "kind": "include"})
        elif ext in ("js", "mjs", "cjs", "ts"):
            m = _JS_IMPORT.match(line) or _JS_REQUIRE.search(line)
            if m:
                out.append({"path": file, "line": i, "target": m.group("path"), "kind": "import"})
        elif ext == "py":
            m = _PY_IMPORT.match(line) or _PY_IMPORT2.match(line)
            if m:
                out.append({"path": file, "line": i, "target": m.group("path"), "kind": "import"})
    return out


def _dep_aliases(file: str) -> list[str]:
    out = [file, _basename(file)]
    if file.endswith((".h", ".hpp", ".hh")):
        stem = file.rsplit(".", 1)[0]
        out.append(stem)
    if file.endswith(".py"):
        out.append(file[:-3].replace("/", "."))
    if file.endswith((".js", ".ts")):
        stem = file.rsplit(".", 1)[0]
        out.append(stem)
    return list(dict.fromkeys(out))

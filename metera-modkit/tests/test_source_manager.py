"""Tests for :mod:`modkit.source_manager`.

No real network or git operations. The subprocess entry point is
patched so each test controls what ``git`` would have returned, and
the tarball fallback is exercised with an in-memory tar.gz payload.
"""

from __future__ import annotations

import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit import source_manager
from modkit.source_manager import (
    SourceError,
    SourceManager,
    SourceSpec,
    default_spec,
)


def _build_tarball(top_dir: str, files: dict[str, bytes]) -> bytes:
    """Return a gzipped tarball whose first member is *top_dir*."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in files.items():
            full = f"{top_dir}/{name}"
            info = tarfile.TarInfo(name=full)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _make_git_completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    """Build a mock CompletedProcess to return from subprocess.run."""
    m = mock.Mock()
    m.stdout = stdout
    m.stderr = stderr
    m.returncode = returncode
    return m


def _patch_git_run(monkeypatch, side_effect):
    """Replace ``subprocess.run`` inside source_manager with a stub."""
    return monkeypatch.setattr(source_manager.subprocess, "run", side_effect)


def _write_fake_git_dir(spec: SourceSpec, root: Path) -> Path:
    """Create a directory at ``<root>/<dir_name>`` with a ``.git`` marker
    and one sample file. Mimics what a real ``git clone`` would leave."""
    d = root / spec.dir_name
    d.mkdir(parents=True, exist_ok=True)
    (d / ".git").mkdir()
    (d / "hello.txt").write_bytes(b"hi")
    return d


class SourceSpecTests(unittest.TestCase):
    def test_dir_name_uses_double_underscore(self):
        s = SourceSpec("Owner", "Repo", "main")
        self.assertEqual(s.dir_name, "Owner__Repo")

    def test_clone_url(self):
        s = SourceSpec("Owner", "Repo", "main")
        self.assertEqual(s.clone_url, "https://github.com/Owner/Repo.git")

    def test_display_name(self):
        s = SourceSpec("Owner", "Repo", "main")
        self.assertEqual(s.display_name, "Owner/Repo@main")

    def test_archive_urls_have_fallbacks(self):
        s = SourceSpec("o", "r", "b")
        urls = s.archive_urls()
        self.assertGreaterEqual(len(urls), 2)
        # jsDelivr first, codeload or github as backup
        self.assertTrue(any("jsdelivr" in u for u in urls))


class SourceManagerStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.mgr = SourceManager(Path(self._tmp.name))
        self.spec = SourceSpec("test", "repo", "main")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_is_cloned_false_on_empty_root(self):
        self.assertFalse(self.mgr.is_cloned(self.spec))

    def test_dir_for_path(self):
        d = self.mgr.dir_for(self.spec)
        self.assertEqual(d, Path(self._tmp.name) / "test__repo")

    def test_is_cloned_true_after_marker(self):
        _write_fake_git_dir(self.spec, Path(self._tmp.name))
        self.assertTrue(self.mgr.is_cloned(self.spec))

    def test_current_sha_none_when_not_cloned(self):
        self.assertIsNone(self.mgr.current_sha(self.spec))

    def test_remote_sha_none_when_not_cloned(self):
        self.assertIsNone(self.mgr.remote_sha(self.spec))


class EnsureReadyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.mgr = SourceManager(Path(self._tmp.name))
        self.spec = SourceSpec("test", "repo", "main")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_first_run_asks_then_clones(self):
        prompts: list[tuple[str, str]] = []

        def prompt(title, body):
            prompts.append((title, body))
            return True

        calls: list[list[str]] = []

        def fake_run(args, **kwargs):
            calls.append(list(args))
            # First call is the clone; second would be a fetch if asked.
            if "clone" in args:
                # Mimic git clone by creating the dir + .git
                d = Path(self._tmp.name) / "test__repo"
                d.mkdir(parents=True, exist_ok=True)
                (d / ".git").mkdir()
                (d / "hello.txt").write_bytes(b"hi")
            return _make_git_completed(stdout="")

        with mock.patch.object(source_manager.subprocess, "run", side_effect=fake_run):
            ok = self.mgr.ensure_ready(self.spec, prompt=prompt)

        self.assertTrue(ok)
        self.assertEqual(len(prompts), 1)
        self.assertIn("test/repo@main", prompts[0][1])
        # The clone was issued
        self.assertTrue(any("clone" in c for c in calls))

    def test_first_run_declined_returns_false(self):
        def prompt(title, body):
            return False

        with mock.patch.object(source_manager.subprocess, "run") as run:
            ok = self.mgr.ensure_ready(self.spec, prompt=prompt)

        self.assertFalse(ok)
        run.assert_not_called()

    def test_already_cloned_and_up_to_date_no_prompt(self):
        _write_fake_git_dir(self.spec, Path(self._tmp.name))

        def fake_run(args, **kwargs):
            cmd = args[3]  # ["git", "-C", dir, "<cmd>", ...]
            if cmd == "rev-parse" and args[-1] == "HEAD":
                return _make_git_completed(stdout="abc123")
            if cmd == "fetch":
                return _make_git_completed(stdout="")
            if cmd == "rev-parse" and args[-1] == "origin/main":
                return _make_git_completed(stdout="abc123")
            return _make_git_completed(stdout="")

        prompts: list[tuple[str, str]] = []

        def prompt(title, body):
            prompts.append((title, body))
            return True

        with mock.patch.object(source_manager.subprocess, "run", side_effect=fake_run):
            ok = self.mgr.ensure_ready(self.spec, prompt=prompt)

        self.assertTrue(ok)
        # No "update?" prompt because local == remote
        self.assertEqual(prompts, [])

    def test_behind_remote_prompts_and_updates(self):
        _write_fake_git_dir(self.spec, Path(self._tmp.name))

        def fake_run(args, **kwargs):
            cmd = args[3]
            if cmd == "rev-parse" and args[-1] == "HEAD":
                return _make_git_completed(stdout="aaa")
            if cmd == "fetch":
                return _make_git_completed(stdout="")
            if cmd == "rev-parse" and args[-1] == "origin/main":
                return _make_git_completed(stdout="bbb")
            if cmd == "reset":
                return _make_git_completed(stdout="")
            return _make_git_completed(stdout="")

        prompts: list[tuple[str, str]] = []

        def prompt(title, body):
            prompts.append((title, body))
            return True

        with mock.patch.object(source_manager.subprocess, "run", side_effect=fake_run):
            ok = self.mgr.ensure_ready(self.spec, prompt=prompt)

        self.assertTrue(ok)
        self.assertEqual(len(prompts), 1)
        self.assertIn("Обновить", prompts[0][0])

    def test_update_false_skips_remote_check(self):
        _write_fake_git_dir(self.spec, Path(self._tmp.name))
        with mock.patch.object(source_manager.subprocess, "run") as run:
            ok = self.mgr.ensure_ready(self.spec, update=False)
        self.assertTrue(ok)
        run.assert_not_called()


class TarballFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.mgr = SourceManager(Path(self._tmp.name))
        self.spec = SourceSpec("test", "repo", "main")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_extract_tarball_flattens_top_dir(self):
        archive = _build_tarball(
            "test-repo-abc123",
            {"src/main.py": b"print(1)", "README.md": b"# hi"},
        )
        dest = Path(self._tmp.name) / "test__repo"
        self.mgr._extract_tarball(archive, dest)
        self.assertTrue((dest / "src" / "main.py").is_file())
        self.assertTrue((dest / "README.md").is_file())
        # The staging dir was removed
        self.assertFalse((Path(self._tmp.name) / "test__repo.__staging__").exists())

    def test_extract_tarball_skips_symlinks(self):
        # Build a tarball that has a symlink; should be ignored.
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            link = tarfile.TarInfo(name="test-repo-x/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/etc/passwd"
            tf.addfile(link)
            data_member = tarfile.TarInfo(name="test-repo-x/real.py")
            payload = b"x = 1\n"
            data_member.size = len(payload)
            tf.addfile(data_member, io.BytesIO(payload))
        dest = Path(self._tmp.name) / "test__repo"
        self.mgr._extract_tarball(buf.getvalue(), dest)
        # The symlink is gone, the real file is there
        self.assertTrue((dest / "real.py").is_file())
        self.assertFalse((dest / "link").exists())

    def test_extract_rejects_path_traversal(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            bad = tarfile.TarInfo(name="test-repo-x/../escape.txt")
            payload = b"pwn"
            bad.size = len(payload)
            tf.addfile(bad, io.BytesIO(payload))
        dest = Path(self._tmp.name) / "test__repo"
        with self.assertRaises(tarfile.TarError):
            self.mgr._extract_tarball(buf.getvalue(), dest)

    def test_download_archive_uses_first_working_mirror(self):
        archive = _build_tarball(
            "test-repo-sha", {"a.py": b"x"}
        )

        call_log: list[str] = []

        def fake_urlopen(req, **kwargs):
            call_log.append(req.full_url)
            if "jsdelivr" in req.full_url:
                resp = mock.Mock()
                resp.read = mock.Mock(return_value=archive)
                resp.__enter__ = lambda s: s
                resp.__exit__ = lambda *a: False
                return resp
            raise OSError("blocked")

        with mock.patch.object(source_manager.urllib.request, "urlopen", side_effect=fake_urlopen):
            dest = Path(self._tmp.name) / "test__repo"
            self.mgr._download_archive_into(self.spec, dest)
        self.assertTrue((dest / "a.py").is_file())
        self.assertTrue(call_log[0].startswith("https://cdn.jsdelivr.net"))

    def test_download_archive_raises_after_all_mirrors_fail(self):
        def boom(*a, **kw):
            raise OSError("nope")

        with mock.patch.object(source_manager.urllib.request, "urlopen", side_effect=boom):
            with self.assertRaises(SourceError) as ctx:
                self.mgr._download_archive_into(
                    self.spec, Path(self._tmp.name) / "test__repo"
                )
        self.assertIn("не удалось", str(ctx.exception))


class DefaultTests(unittest.TestCase):
    def test_default_spec_is_gardenxsa(self):
        s = default_spec()
        self.assertEqual(s.owner, "GardenXsa")
        self.assertEqual(s.repo, "metera_d25_cp3-newAge")


if __name__ == "__main__":
    unittest.main()

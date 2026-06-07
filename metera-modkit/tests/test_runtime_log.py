"""Tests for :mod:`modkit.tools.runtime_log`.

These tests exercise the parser + categoriser without touching the
real ``runtime.log`` on the user's machine — every fixture is
written to a temp file so the tests are hermetic.
"""

from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path

from modkit.tools.runtime_log import (
    RuntimeLogReport,
    categorise,
    file_size,
    parse_runtime_log,
    read_errors_since,
)


def _write_log(path: Path, lines: list[dict]) -> None:
    """Write one JSON object per line, then a trailing newline."""
    with path.open("w", encoding="utf-8") as fh:
        for entry in lines:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


SAMPLE_LINES = [
    # preflight — JS ModLoader
    {"ts": "2026-06-05T12:00:00Z", "level": "error", "scope": "ModLoader",
     "message": "Мод foo отключён: eras:rebirth: missing default_location_file",
     "detail": {"mod_id": "foo"}},
    # engine — C++ engine
    {"ts": "2026-06-05T12:00:01Z", "level": "error", "scope": "Nexus",
     "message": "DATA ERROR: item 'silt_blade' references unknown tag 'weapon_typo'",
     "detail": {"stack": "Traceback..."}},
    # renderer — unhandled JS exception (the exact bug the user hit)
    {"ts": "2026-06-05T12:00:02Z", "level": "error", "scope": "UnhandledPromise",
     "message": "Unhandled promise rejection",
     "detail": {"name": "TypeError", "message": "Cannot read properties of undefined (reading 'split')",
                "stack": "at t (script.js:6594:27)\n    at populateRacesUI (script.js:4808:53)"}},
    # renderer — global onerror
    {"ts": "2026-06-05T12:00:03Z", "level": "error", "scope": "RendererError",
     "message": "TypeError: window.foo is not a function",
     "detail": {"filename": "script.js", "lineno": 1234}},
    # warn — should be included when min_level=warn
    {"ts": "2026-06-05T12:00:04Z", "level": "warn", "scope": "ModKit",
     "message": "Не удалось сохранить отключение мода",
     "detail": None},
    # info — should be skipped when min_level=warn
    {"ts": "2026-06-05T12:00:05Z", "level": "info", "scope": "ModLoader",
     "message": "Мод bar успешно загружен",
     "detail": None},
]


class ParseRuntimeLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "runtime.log"
        _write_log(self.path, SAMPLE_LINES)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_parses_every_line(self) -> None:
        r = parse_runtime_log(self.path)
        self.assertEqual(r.parsed, len(SAMPLE_LINES))
        self.assertEqual(r.skipped_malformed, 0)
        self.assertEqual(r.total_lines, len(SAMPLE_LINES))

    def test_min_level_filter(self) -> None:
        # info-level (1) entries are filtered out
        r = parse_runtime_log(self.path, min_level="warn")
        # 1 warn + 4 errors = 5 entries
        self.assertEqual(r.parsed, 5)
        self.assertTrue(all(e.level in ("error", "warn") for e in r.entries))

    def test_categorise_preflight(self) -> None:
        r = parse_runtime_log(self.path)
        preflight = r.by_category("preflight")
        scopes = {e.scope for e in preflight}
        self.assertIn("ModLoader", scopes)

    def test_categorise_engine(self) -> None:
        r = parse_runtime_log(self.path)
        engine = r.by_category("engine")
        scopes = {e.scope for e in engine}
        self.assertIn("Nexus", scopes)

    def test_categorise_renderer(self) -> None:
        r = parse_runtime_log(self.path)
        renderer = r.by_category("renderer")
        scopes = {e.scope for e in renderer}
        self.assertIn("UnhandledPromise", scopes)
        self.assertIn("RendererError", scopes)

    def test_from_byte_offset(self) -> None:
        # Read first half the file, then resume from where we stopped
        size = file_size(self.path)
        first = parse_runtime_log(self.path, from_byte=0)
        self.assertGreater(first.parsed, 0)
        # Reading from a huge offset returns an empty report
        empty = parse_runtime_log(self.path, from_byte=size + 100)
        self.assertEqual(empty.parsed, 0)

    def test_read_errors_since_returns_new_offset(self) -> None:
        report, new_offset = read_errors_since(self.path, 0)
        self.assertGreater(report.parsed, 0)
        self.assertEqual(new_offset, file_size(self.path))


class ParseRuntimeLogEdgeCasesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "runtime.log"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_missing_file_returns_empty_report(self) -> None:
        missing = Path(self.tmp.name) / "nope.log"
        r = parse_runtime_log(missing)
        self.assertEqual(r.parsed, 0)
        self.assertEqual(r.total_lines, 0)
        self.assertFalse(r.errors)

    def test_malformed_lines_are_skipped(self) -> None:
        self.path.write_text(
            textwrap.dedent("""\
                {"ts": "2026-06-05T12:00:00Z", "level": "error", "scope": "ModLoader", "message": "real", "detail": null}
                this is not JSON
                {"ts": "2026-06-05T12:00:01Z", "level": "error", "scope": "Nexus", "message": "real2", "detail": null}
                {not even close to json}
                """),
            encoding="utf-8",
        )
        r = parse_runtime_log(self.path)
        self.assertEqual(r.parsed, 2)
        self.assertEqual(r.skipped_malformed, 2)

    def test_empty_scope_falls_back_to_message_sniffing(self) -> None:
        _write_log(self.path, [
            {"ts": "...", "level": "error", "scope": "", "message": "[ModLoader] something", "detail": None},
            {"ts": "...", "level": "error", "scope": "", "message": "[Nexus] something", "detail": None},
            {"ts": "...", "level": "error", "scope": "", "message": "free-form", "detail": None},
        ])
        r = parse_runtime_log(self.path)
        cats = [e.category for e in r.entries]
        self.assertEqual(cats, ["preflight", "engine", "renderer"])


class CategoriseUnitTests(unittest.TestCase):
    def test_known_scopes(self) -> None:
        from modkit.tools.runtime_log import LogEntry
        for scope, want in [
            ("ModLoader", "preflight"),
            ("ModGuard", "preflight"),
            ("ModKit", "preflight"),
            ("ModAPI", "preflight"),
            ("RuntimeData", "preflight"),
            ("Nexus", "engine"),
            ("NexusCartographer", "engine"),
            ("NexusParseError", "engine"),
            ("UnhandledPromise", "renderer"),
            ("RendererError", "renderer"),
            ("EventBus", "renderer"),
            ("CustomScope", "renderer"),
        ]:
            entry = LogEntry(ts="", level="error", scope=scope, message="x")
            entry.category = categorise(entry)
            self.assertEqual(entry.category, want, f"scope={scope!r}")


if __name__ == "__main__":
    unittest.main()

"""Count lines in all text files of the Metera project.

Usage:
    py count_lines.py                          # scan default project root
    py count_lines.py --root <path>            # scan a different root
    py count_lines.py --per-file               # also show top contributors
    py count_lines.py --ext .py --ext .md      # restrict to certain extensions

Skips directories that are pure VCS / build / cache noise (``.git``,
``node_modules``, ``__pycache__``, ``dist``, ``build``, virtualenvs,
``.superpowers``, etc.) and any file that smells binary (NUL byte in
the first chunk) or is bigger than ``--max-bytes`` (default 5 MB).
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_ROOT = r"C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21-111"

SKIP_DIRS = {
    ".git", "__pycache__", "node_modules", "dist", "build",
    ".venv", "venv", ".superpowers", ".pytest_cache", ".mypy_cache",
    ".idea", ".vscode", "ProtoSystem",
}

# Lock files, generated dumps, ad-hoc junk.
SKIP_FILES = {
    "package-lock.json",
    "metera_d25_cp3-01-21_scan_full.txt",
    "tmp_e.log",
    "local_diff.txt",
}

# Default text extensions. Override with --ext.
DEFAULT_TEXT_EXTS = {
    ".py", ".md", ".txt", ".json", ".toml", ".yaml", ".yml",
    ".cfg", ".ini", ".html", ".css", ".js", ".ts", ".jsx", ".tsx",
    ".sh", ".bat", ".cmd", ".ps1", ".qss", ".spec",
    ".c", ".cpp", ".h", ".hpp", ".rs", ".go", ".java", ".kt",
    ".xml", ".csv", ".tsv", ".lua", ".glsl", ".vert", ".frag",
}


def is_binary(path: Path, sniff_bytes: int = 8192) -> bool:
    """Heuristic: NUL byte in the first chunk means binary."""
    try:
        with path.open("rb") as f:
            chunk = f.read(sniff_bytes)
    except OSError:
        return True
    return b"\x00" in chunk


def count_lines(path: Path, max_bytes: int) -> int | None:
    """Return line count, or ``None`` if the file should be skipped."""
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if size == 0:
        return 0
    if size > max_bytes:
        return None
    if is_binary(path):
        return None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except OSError:
        return None


def iter_candidates(
    root: Path,
    skip_dirs: set[str],
    skip_files: set[str],
    text_exts: set[str],
):
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part in skip_dirs for part in rel_parts[:-1]):
            continue
        if path.name in skip_files:
            continue
        if path.suffix.lower() not in text_exts:
            continue
        yield path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Count lines in text files of a project.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--root",
        default=DEFAULT_ROOT,
        help="Project root to scan.",
    )
    parser.add_argument(
        "--ext",
        action="append",
        default=None,
        help="Restrict to this extension (repeatable, e.g. --ext .py --ext .md). "
             "Default: a built-in set of text extensions.",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=5_000_000,
        help="Skip files larger than this many bytes (likely binary dumps).",
    )
    parser.add_argument(
        "--per-file",
        type=int,
        default=0,
        metavar="N",
        help="Show the top N files by line count (0 = omit).",
    )
    parser.add_argument(
        "--no-skip-dirs",
        action="store_true",
        help="Don't skip the default noise directories.",
    )
    args = parser.parse_args(argv)

    root = Path(args.root)
    if not root.exists():
        print(f"error: {root} does not exist", file=sys.stderr)
        return 1
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    text_exts = (
        {e.lower() if e.startswith(".") else f".{e.lower()}" for e in args.ext}
        if args.ext else DEFAULT_TEXT_EXTS
    )
    skip_dirs = set() if args.no_skip_dirs else SKIP_DIRS

    per_ext_files: dict[str, int] = defaultdict(int)
    per_ext_lines: dict[str, int] = defaultdict(int)
    per_file: list[tuple[int, str]] = []

    total_files = 0
    total_lines = 0
    skipped = 0

    for path in iter_candidates(root, skip_dirs, SKIP_FILES, text_exts):
        n = count_lines(path, args.max_bytes)
        if n is None:
            skipped += 1
            continue
        ext = path.suffix.lower() or "(none)"
        per_ext_files[ext] += 1
        per_ext_lines[ext] += n
        per_file.append((n, str(path.relative_to(root))))
        total_files += 1
        total_lines += n

    print(f"Scanned:           {root}")
    print(f"Text extensions:   {len(text_exts)} ({sorted(text_exts)})")
    print(f"Files counted:     {total_files}")
    print(f"Lines total:       {total_lines:,}")
    print(f"Files skipped:     {skipped} (binary, oversized, or non-text)")
    print()
    print(f"{'ext':<10}  {'files':>8}  {'lines':>12}  {'avg':>8}")
    print(f"{'-'*10}  {'-'*8}  {'-'*12}  {'-'*8}")
    for ext in sorted(per_ext_lines, key=lambda e: -per_ext_lines[e]):
        files = per_ext_files[ext]
        lines = per_ext_lines[ext]
        avg = lines // files if files else 0
        print(f"{ext:<10}  {files:>8}  {lines:>12,}  {avg:>8,}")

    if args.per_file > 0:
        print()
        print(f"Top {args.per_file} files by line count:")
        width = max((len(f"{n:,}") for n, _ in per_file), default=0)
        for n, rel in sorted(per_file, key=lambda x: -x[0])[: args.per_file]:
            print(f"  {n:>{width},}  {rel}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

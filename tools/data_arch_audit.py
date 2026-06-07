import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Pattern


@dataclass(frozen=True)
class Rule:
    code: str
    severity: str
    pattern: Pattern[str]
    message: str
    include_ext: tuple[str, ...] = ('.cpp', '.h', '.hpp', '.c', '.cc', '.js', '.mjs', '.json', '.py')


@dataclass(frozen=True)
class Finding:
    rule: Rule
    path: Path
    line_number: int
    line: str


DEFAULT_EXCLUDE_DIRS = {
    '.git',
    'node_modules',
    'dist',
    'build',
    'out',
    'release',
    '__pycache__',
    '.pytest_cache',
    '.ai_backups',
    'backup',
    'backups',
    'data',
    'mods',
    'saves',
}

DEFAULT_INCLUDE_EXTS = ('.cpp', '.h', '.hpp', '.c', '.cc', '.js', '.mjs', '.py')
DEFAULT_MAX_FILE_BYTES = 512 * 1024

# Files that are intentionally not runtime/source targets for this audit.
# They may contain legacy words inside regexes, comments, or migration snippets.
DEFAULT_EXCLUDE_FILES = {
    'tools/data_arch_audit.py',
    'cleanup_phase2.py',
    'fix.py',
}

# Критичные правила: это то, что мешает "безоговорочному" data-driven режиму.
RULES: tuple[Rule, ...] = (
    Rule(
        code='LEGACY_GOODTYPE',
        severity='ERROR',
        pattern=re.compile(r'\bGoodType\b'),
        message='Осталась зависимость от GoodType/старой enum-архитектуры.',
    ),
    Rule(
        code='GENERATED_DATA',
        severity='ERROR',
        pattern=re.compile(r'generated_data\.(h|hpp)|generate_data\.py'),
        message='Осталась зависимость от generated_data/generate_data.',
    ),
    Rule(
        code='TAG_FALLBACK_ARG',
        severity='ERROR',
        pattern=re.compile(r'getCoreIdByTag\s*\(\s*[^,\n]+,\s*[^)]+\)'),
        message='getCoreIdByTag вызывается с hardcoded fallback. Нужно перенести fallback в data/tag_defaults.json.',
    ),
    Rule(
        code='FALLBACK_ID_SYMBOL',
        severity='ERROR',
        pattern=re.compile(r'\bfallbackId\b'),
        message='В коде остался символ fallbackId — вероятно, старый hardcoded fallback ещё не удалён.',
    ),
    Rule(
        code='HARDCODED_DEFAULTS',
        severity='WARN',
        pattern=re.compile(r'fallback|hardcoded|default(?:s)?\s*=|DEFAULT_[A-Z0-9_]+', re.IGNORECASE),
        message='Проверь fallback/default: он может быть допустимым UI/debug fallback или остатком старой архитектуры.',
    ),
    Rule(
        code='MIGRATION_SCRIPT',
        severity='INFO',
        pattern=re.compile(r'cleanup_phase\d+\.py|fix\.py'),
        message='Найден временный миграционный скрипт. После завершения этапов его лучше перенести в tools/migrations или удалить.',
        include_ext=('.py', '.txt', '.md'),
    ),
)


def iter_files(
    root: Path,
    exclude_dirs: set[str],
    exclude_files: set[str],
    include_exts: tuple[str, ...],
    max_file_bytes: int,
) -> Iterable[Path]:
    for current_root, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        current_path = Path(current_root)
        for file_name in files:
            path = current_path / file_name
            rel_path = path.relative_to(root).as_posix()

            if rel_path in exclude_files or file_name in exclude_files:
                continue

            if path.suffix.lower() not in include_exts:
                continue

            try:
                if path.stat().st_size > max_file_bytes:
                    continue
            except OSError:
                continue

            yield path


def scan_file(path: Path, root: Path) -> List[Finding]:
    findings: List[Finding] = []
    suffix = path.suffix.lower()
    active_rules = [rule for rule in RULES if suffix in rule.include_ext]
    if not active_rules:
        return findings

    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        print(f'[WARN] cannot read {path}: {exc}', file=sys.stderr)
        return findings

    rel_path = path.relative_to(root)
    for line_number, line in enumerate(text.splitlines(), start=1):
        for rule in active_rules:
            if rule.pattern.search(line):
                findings.append(Finding(rule=rule, path=rel_path, line_number=line_number, line=line.strip()))
    return findings


def print_report(findings: List[Finding], max_lines_per_rule: int = 20, verbose: bool = False) -> int:
    if not findings:
        print('DATA ARCH AUDIT: OK — legacy blockers were not found.')
        return 0

    severity_order = {'ERROR': 0, 'WARN': 1, 'INFO': 2}
    findings = sorted(findings, key=lambda f: (severity_order.get(f.rule.severity, 99), str(f.path), f.line_number, f.rule.code))

    severity_counts: dict[str, int] = {}
    rule_counts: dict[str, int] = {}
    grouped: dict[str, List[Finding]] = {}

    for finding in findings:
        severity_counts[finding.rule.severity] = severity_counts.get(finding.rule.severity, 0) + 1
        rule_counts[finding.rule.code] = rule_counts.get(finding.rule.code, 0) + 1
        grouped.setdefault(finding.rule.code, []).append(finding)

    print('DATA ARCH AUDIT: findings')
    print('=========================')
    print('Summary: ' + ', '.join(f'{severity}={count}' for severity, count in sorted(severity_counts.items())))
    print()

    for rule_code, items in grouped.items():
        first = items[0]
        print(f'[{first.rule.severity}] {first.rule.code}: {first.rule.message}')
        print(f'  total: {len(items)}')

        limit = len(items) if verbose else max_lines_per_rule
        for finding in items[:limit]:
            print(f'  - {finding.path}:{finding.line_number}: {finding.line[:180]}')

        hidden = len(items) - limit
        if hidden > 0:
            print(f'  ... hidden: {hidden}. Use --verbose to print all matches.')
        print()

    error_count = severity_counts.get('ERROR', 0)
    if error_count:
        print(f'FAIL: {error_count} critical data-architecture blocker(s) found.')
        return 1

    print('PASS: no critical blockers found. Review WARN/INFO items manually.')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Audit remaining blockers for the final data-driven architecture migration.')
    parser.add_argument('--root', default='.', help='Project root. Default: current directory.')
    parser.add_argument('--exclude-dir', action='append', default=[], help='Additional directory name to exclude. Can be used multiple times.')
    parser.add_argument('--exclude-file', action='append', default=[], help='Additional file path or file name to exclude. Can be used multiple times.')
    parser.add_argument('--include-data', action='store_true', help='Also scan data/ and mods/. Slower; disabled by default.')
    parser.add_argument('--max-file-kb', type=int, default=512, help='Skip files larger than this size. Default: 512 KB.')
    parser.add_argument('--max-lines-per-rule', type=int, default=20, help='Compact output: max printed matches per rule. Default: 20.')
    parser.add_argument('--verbose', action='store_true', help='Print all matches. Can be very long.')
    args = parser.parse_args()

    root = Path(args.root).resolve()
    exclude_dirs = set(DEFAULT_EXCLUDE_DIRS)
    exclude_dirs.update(args.exclude_dir)

    exclude_files = set(DEFAULT_EXCLUDE_FILES)
    exclude_files.update(path.replace('\\', '/') for path in args.exclude_file)

    include_exts = DEFAULT_INCLUDE_EXTS
    if args.include_data:
        exclude_dirs.discard('data')
        exclude_dirs.discard('mods')
        include_exts = DEFAULT_INCLUDE_EXTS + ('.json', '.md', '.txt')

    all_findings: List[Finding] = []
    for path in iter_files(root, exclude_dirs, exclude_files, include_exts, args.max_file_kb * 1024):
        all_findings.extend(scan_file(path, root))

    return print_report(all_findings, max_lines_per_rule=args.max_lines_per_rule, verbose=args.verbose)


if __name__ == '__main__':
    raise SystemExit(main())

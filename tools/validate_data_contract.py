import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List


@dataclass(frozen=True)
class ContractFinding:
    severity: str
    code: str
    message: str


def load_json(path: Path) -> Any:
    try:
        with path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        raise RuntimeError(f'Missing required data file: {path}')
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Invalid JSON in {path}: {exc}')


def load_item_database(data_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Load all base item-like databases that can be referenced by tag_defaults."""
    item_files = [
        data_dir / 'economy_items.json',
        data_dir / 'items.json',
    ]

    items: Dict[str, Dict[str, Any]] = {}
    for path in item_files:
        if not path.exists():
            continue

        raw = load_json(path)
        if not isinstance(raw, dict):
            raise RuntimeError(f'{path} must contain a JSON object keyed by item id')

        for item_id, item_def in raw.items():
            if isinstance(item_def, dict):
                merged = dict(items.get(item_id, {}))
                merged.update(item_def)
                items[item_id] = merged
            else:
                items[item_id] = {'value': item_def}

    return items


def get_tags(item_def: Dict[str, Any]) -> List[str]:
    tags = item_def.get('tags', [])
    if not isinstance(tags, list):
        return []
    return [tag for tag in tags if isinstance(tag, str)]


def iter_default_references(tag_defaults: Dict[str, Any]) -> Iterable[tuple[str, str, bool]]:
    """
    Yield (semantic_tag, item_id, should_have_same_tag).

    String entries are canonical defaults and should normally point to an item
    that carries the same semantic tag. List entries are explicit pools/lists;
    their items only need to exist.
    """
    for semantic_tag, value in tag_defaults.items():
        if isinstance(value, str):
            yield semantic_tag, value, True
        elif isinstance(value, list):
            for item_id in value:
                if isinstance(item_id, str):
                    yield semantic_tag, item_id, False


def validate(root: Path, strict_tags: bool = False) -> List[ContractFinding]:
    data_dir = root / 'data'
    manifest_path = data_dir / 'runtime_manifest.json'
    tag_defaults_path = data_dir / 'tag_defaults.json'

    raw_manifest = load_json(manifest_path)
    if not isinstance(raw_manifest, dict):
        raise RuntimeError(f'{manifest_path} must contain a JSON object')

    schema_version = raw_manifest.get('schemaVersion')
    if schema_version != 1:
        raise RuntimeError(f'{manifest_path} must declare schemaVersion: 1')

    raw_tag_defaults = load_json(tag_defaults_path)
    if not isinstance(raw_tag_defaults, dict):
        raise RuntimeError(f'{tag_defaults_path} must contain a JSON object')

    items = load_item_database(data_dir)
    findings: List[ContractFinding] = []

    if not items:
        findings.append(ContractFinding('ERROR', 'NO_ITEMS_LOADED', 'No item definitions were loaded from data/economy_items.json or data/items.json'))
        return findings

    required_item_fields = raw_manifest.get('contracts', {}).get('items', {}).get('required_fields', [])
    if not isinstance(required_item_fields, list):
        findings.append(ContractFinding('ERROR', 'INVALID_ITEM_CONTRACT', 'runtime_manifest.contracts.items.required_fields must be a list'))
        required_item_fields = []

    for item_id, item_def in sorted(items.items()):
        for field in required_item_fields:
            if not isinstance(field, str):
                continue
            if field not in item_def:
                findings.append(ContractFinding(
                    'WARN',
                    'ITEM_MISSING_CONTRACT_FIELD',
                    f'item "{item_id}" is missing contract field "{field}"',
                ))

    seen_refs: set[tuple[str, str]] = set()
    for semantic_tag, item_id, should_have_same_tag in iter_default_references(raw_tag_defaults):
        ref_key = (semantic_tag, item_id)
        if ref_key in seen_refs:
            continue
        seen_refs.add(ref_key)

        item_def = items.get(item_id)
        if item_def is None:
            findings.append(ContractFinding(
                'ERROR',
                'TAG_DEFAULT_MISSING_ITEM',
                f'tag_defaults["{semantic_tag}"] references missing item id "{item_id}"',
            ))
            continue

        if should_have_same_tag:
            tags = get_tags(item_def)
            if semantic_tag not in tags:
                severity = 'ERROR' if strict_tags else 'WARN'
                findings.append(ContractFinding(
                    severity,
                    'TAG_DEFAULT_ITEM_MISSING_TAG',
                    f'tag_defaults["{semantic_tag}"] = "{item_id}", but item tags are {tags or "<empty>"}',
                ))

    return findings


def print_report(findings: List[ContractFinding]) -> int:
    if not findings:
        print('DATA CONTRACT: OK — tag_defaults references are valid.')
        return 0

    counts: Dict[str, int] = {}
    for finding in findings:
        counts[finding.severity] = counts.get(finding.severity, 0) + 1

    print('DATA CONTRACT: findings')
    print('=======================')
    print('Summary: ' + ', '.join(f'{severity}={count}' for severity, count in sorted(counts.items())))
    print()

    for finding in findings:
        print(f'[{finding.severity}] {finding.code}: {finding.message}')

    error_count = counts.get('ERROR', 0)
    if error_count:
        print()
        print(f'FAIL: {error_count} data contract error(s) found.')
        return 1

    print()
    print('PASS: no data contract errors found. Review WARN items before enabling --strict-tags.')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Validate base data contract for tag_defaults and item definitions.')
    parser.add_argument('--root', default='.', help='Project root. Default: current directory.')
    parser.add_argument('--strict-tags', action='store_true', help='Treat missing item tags for tag_defaults as errors instead of warnings.')
    args = parser.parse_args()

    root = Path(args.root).resolve()
    try:
        findings = validate(root, strict_tags=args.strict_tags)
    except RuntimeError as exc:
        print(f'DATA CONTRACT: ERROR — {exc}')
        return 1

    return print_report(findings)


if __name__ == '__main__':
    raise SystemExit(main())

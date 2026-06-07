"""Smoke test for the new agent tools."""
import sys
import os
import tempfile
from pathlib import Path

sys.path.insert(0, r'C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21-111\metera-modkit')

from modkit.tools.runtime_log import parse_runtime_log, runtime_log_path
from modkit.tools.custom_checks import (
    register_check, list_checks, run_checks, CheckContext,
    fail, pass_, warn, unregister_check, checks_root,
)
from modkit.tools.validate_e2e import build_validate_e2e_tool, find_project_root


# 1. Parser
p = runtime_log_path()
print(f'log path: {p}')
r = parse_runtime_log(p, min_level='error')
print(f'parser: total={r.total_lines} parsed={r.parsed} errors={len(r.errors)}')
print(f'  renderer={len(r.by_category("renderer"))} preflight={len(r.by_category("preflight"))} engine={len(r.by_category("engine"))}')


# 2. Custom checks roundtrip
register_check('always_fail', '''
def check(ctx):
    return fail("this is intentionally broken", fix_hint="don't worry about it")
''')
register_check('mixed', '''
def check(ctx):
    return [pass_("ok"), warn("be careful"), fail("nope")]
''')

print(f'\nlist_checks (in {checks_root()}):')
for c in list_checks():
    if c['name'] in ('always_fail', 'mixed'):
        print(f'  {c}')

ctx = CheckContext(mods_root=None, project_root=None)
res = run_checks(ctx, names=['always_fail', 'mixed'])
print(f'\nran {len(res)} checks:')
for r in res:
    print(f'  {r}')


# 3. Project root detection
start_path = Path(r"C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21-111\metera-modkit")
found = find_project_root(start_path)
print(f'\nproject root: {found}')


# 4. Tool wrapper
tool = build_validate_e2e_tool()
print(f'\ntool name: {tool.name}')
print(f'tool kind: {tool.kind}')


# cleanup
unregister_check('always_fail')
unregister_check('mixed')
print('\nOK')

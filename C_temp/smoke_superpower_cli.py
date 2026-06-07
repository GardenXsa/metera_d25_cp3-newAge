"""End-to-end smoke test for `modkit superpower` subcommands."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(r"C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21-111\metera-modkit")
PY = sys.executable


def run(args, env=None, check=True):
    print(f"\n>>> {' '.join(args)}")
    proc = subprocess.run([PY, "-m", "modkit.cli", *args], cwd=ROOT, capture_output=True, text=True, env=env or os.environ.copy())
    if proc.stdout:
        print("STDOUT:")
        print(proc.stdout)
    if proc.stderr:
        print("STDERR:")
        print(proc.stderr)
    if check and proc.returncode != 0:
        raise SystemExit(f"command failed: rc={proc.returncode}")
    return proc


# Use a temp user_config_dir so we don't pollute the real one.
tmp = Path(tempfile.mkdtemp(prefix="modkit_sp_smoke_"))
print(f"using tempdir: {tmp}")

# APPDATA -> the per-user config dir lives at %APPDATA%/metera-modkit
env = os.environ.copy()
env["APPDATA"] = str(tmp)
# On Windows APPDATA is the only one read by paths.user_config_dir.
# But we must NOT touch the real game mods dir; pass --mods-dir to a sandbox.
mods_sandbox = tmp / "mods"
mods_sandbox.mkdir(parents=True, exist_ok=True)

# 1) superpower new --target user my_demo
run(["--json", "superpower", "new", "my_demo",
     "--target", "user", "--style", "json-tools",
     "--description", "smoke test"], env=env)

# Verify the files were created.
sp_dir = tmp / "metera-modkit" / "superpowers" / "my_demo"
print(f"sp_dir exists: {sp_dir.is_dir()}")
for f in ("superpower.json", "tools.json"):
    p = sp_dir / f
    print(f"  {f}: exists={p.is_file()} size={p.stat().st_size if p.is_file() else 0}")
    if p.is_file():
        print("    content:", p.read_text(encoding="utf-8")[:300])

# 2) superpower new with prompt-only style (different flavour)
run(["superpower", "new", "lore_keeper",
     "--style", "prompt-only", "--description", "Tone rules"], env=env)
lore_dir = tmp / "metera-modkit" / "superpowers" / "lore_keeper"
print(f"lore prompt.md exists: {(lore_dir / 'prompt.md').is_file()}")

# 3) superpower new with python-tools style
run(["superpower", "new", "py_helper", "--style", "python-tools"], env=env)
py_dir = tmp / "metera-modkit" / "superpowers" / "py_helper"
print(f"py tools.py exists: {(py_dir / 'tools.py').is_file()}")

# 4) superpower validate the new one
run(["--json", "superpower", "validate", str(sp_dir)], env=env)

# 5) superpower list
run(["--json", "superpower", "list"], env=env)

# 6) Try to create the same one again -> should fail
proc = run(["superpower", "new", "my_demo", "--style", "json-tools"], env=env, check=False)
assert proc.returncode != 0, "duplicate create should fail"

# 7) Validate a non-existent path
proc = run(["superpower", "validate", "does_not_exist_xyz"], env=env, check=False)
assert proc.returncode != 0, "missing path should fail"

shutil.rmtree(tmp, ignore_errors=True)
print("\nALL SMOKE TESTS PASSED")

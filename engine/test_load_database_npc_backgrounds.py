#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time

from engine_client import build_runtime_database


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_EXE = os.path.join(
    ENGINE_DIR,
    "meterea_engine.exe" if sys.platform == "win32" else "meterea_engine",
)


def read_json_line(proc, timeout_seconds=30):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise AssertionError(
                f"engine exited before response: code={proc.returncode}\n{stderr}"
            )

        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            continue

        line = line.strip()
        if not line:
            continue
        return json.loads(line)

    raise AssertionError(f"timed out waiting for engine response after {timeout_seconds}s")


def send_command(proc, payload, timeout_seconds=30):
    proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    proc.stdin.flush()
    while True:
        response = read_json_line(proc, timeout_seconds)
        if response.get("status") in ("ready", "progress", "hook_event"):
            continue
        return response


def main():
    assert os.path.exists(ENGINE_EXE), f"engine binary not found: {ENGINE_EXE}"

    runtime_db = build_runtime_database(os.path.join(ROOT, "data"))
    proc = subprocess.Popen(
        [ENGINE_EXE],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
    )

    try:
        ready = read_json_line(proc, 10)
        assert ready.get("status") == "ready", ready

        init_result = send_command(
            proc,
            {"command": "init", "mods_dir": os.path.join(ROOT, "mods"), "active_mods": []},
            30,
        )
        assert init_result.get("status") == "ok", init_result

        load_result = send_command(
            proc,
            {
                "command": "loadDatabase",
                "items": runtime_db["items"],
                "recipes": runtime_db["recipes"],
                "facilities": runtime_db["facilities"],
                "npc_backgrounds": runtime_db["npc_backgrounds"],
            },
            30,
        )
        assert load_result.get("status") == "ok", load_result
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    print("loadDatabase npc_backgrounds regression test OK")


if __name__ == "__main__":
    main()

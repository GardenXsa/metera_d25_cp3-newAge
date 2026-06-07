#!/usr/bin/env python3
import os
import sys
import tempfile
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine_client import build_runtime_database, resolve_era_location_file


def test_resolve_era_location_file_uses_metadata_and_fallback():
    eras = [
        {"id": "rebirth", "default_location_file": "locations_expanded.json"},
        {"id": "void_age"}
    ]
    result = resolve_era_location_file(eras, "void_age", "locations_rebirth.json")
    assert result["file_name"] == "locations_rebirth.json"
    assert result["used_fallback"] is True
    assert "void_age" in result["warning"]


def test_build_runtime_database_loads_prompt_pack_content():
    with tempfile.TemporaryDirectory() as tmpdir:
        prompt_path = os.path.join(tmpdir, "prompt.txt")
        manifest_path = os.path.join(tmpdir, "runtime_manifest.json")
        prompt_pack_path = os.path.join(tmpdir, "prompt_pack.json")

        with open(prompt_path, "w", encoding="utf-8") as handle:
            handle.write("PROMPT_CONTENT")

        with open(prompt_pack_path, "w", encoding="utf-8") as handle:
            json.dump({
                "entries": {
                    "environment_commands_guide": {"path": "prompt.txt"}
                },
                "aliases": {}
            }, handle)

        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump({
                "database_files": {
                    "prompt_pack": {"path": "prompt_pack.json", "default_type": "object"}
                },
                "era_location_fallback_file": "locations_rebirth.json"
            }, handle)

        db = build_runtime_database(tmpdir, manifest_path=manifest_path)
        entry = db["prompt_pack"]["entries"]["environment_commands_guide"]
        assert entry["content"] == "PROMPT_CONTENT"


if __name__ == "__main__":
    test_resolve_era_location_file_uses_metadata_and_fallback()
    test_build_runtime_database_loads_prompt_pack_content()
    print("runtime bundle tests passed")

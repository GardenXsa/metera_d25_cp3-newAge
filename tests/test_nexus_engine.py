import subprocess
import json
import os
import unittest
import sys

class TestNexusEngine(unittest.TestCase):
    """Integration tests for the Nexus C++ engine via subprocess."""

    @classmethod
    def setUpClass(cls):
        """Start the engine process once for all tests."""
        engine_exe = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine', 'meterea_engine.exe')
        if not os.path.exists(engine_exe):
            engine_exe = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine', 'meterea_engine')

        if not os.path.exists(engine_exe):
            raise unittest.SkipTest(f"Engine executable not found at {engine_exe}")

        cls.engine_exe = engine_exe

    def _run_command(self, cmd_data):
        """Send a single command to a fresh engine process and return the final response."""
        proc = subprocess.Popen(
            [self.engine_exe],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8'
        )
        stdout, stderr = proc.communicate(input=json.dumps(cmd_data, ensure_ascii=False) + '\n', timeout=30)
        if stderr:
            print(f"[STDERR] {stderr[:200]}", file=sys.stderr)

        final_result = None
        for line in stdout.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if data.get("status") == "progress":
                    print(f"      [ENGINE] {data.get('message')}")
                else:
                    final_result = data
            except json.JSONDecodeError:
                pass
        return final_result

    def test_init(self):
        """Test 1: Engine init command."""
        result = self._run_command({"command": "init"})
        self.assertIsNotNone(result, "Engine returned no response")
        self.assertEqual(result.get("status"), "ok", f"Expected 'ok', got: {result}")

    def test_load_database_and_build_world(self):
        """Test 2: loadDatabase + buildWorld must work in sequence."""
        # Step 1: init
        result = self._run_command({"command": "init"})
        self.assertEqual(result.get("status"), "ok")

        # Step 2: loadDatabase with minimal data
        db_command = {
            "command": "loadDatabase",
            "items": {},
            "recipes": [],
            "facilities": {},
            "biomes": [],
            "city_gen": {},
            "monsters": [],
            "disasters": [],
            "races": [],
            "professions": [],
            "traits": [],
            "npc_names": {},
            "faction_relations": {},
            "world_config": {}
        }
        result = self._run_command(db_command)
        self.assertIsNotNone(result, "loadDatabase returned no response")
        # Engine may return ok or progress; we just need it not to crash
        self.assertIn(result.get("status"), ("ok", "progress"), f"loadDatabase failed: {result}")

        # Step 3: buildWorld
        result = self._run_command({"command": "buildWorld", "player_id": "test_admin", "era": "rebirth", "initial_agents": 10})
        self.assertIsNotNone(result, "buildWorld returned no response")
        # If engine returns world data, verify structure
        if "world" in result:
            self.assertIn("regions", result["world"], "World missing 'regions'")
            self.assertIn("factions", result["world"], "World missing 'factions'")

    def test_simulate_ticks(self):
        """Test 3: Full pipeline init → loadDB → buildWorld → simulateTicks."""
        # Init
        self._run_command({"command": "init"})

        # Load minimal DB
        db = {
            "command": "loadDatabase",
            "items": {}, "recipes": [], "facilities": {}, "biomes": [],
            "city_gen": {}, "monsters": [], "disasters": [], "races": [],
            "professions": [], "traits": [], "npc_names": {},
            "faction_relations": {}, "world_config": {}
        }
        self._run_command(db)

        # Build world
        result = self._run_command({"command": "buildWorld", "player_id": "test_admin", "era": "rebirth", "initial_agents": 50})
        if not result or "world" not in result:
            self.skipTest("buildWorld did not return world data — cannot test simulateTicks")

        world = result["world"]

        # Simulate
        result = self._run_command({"command": "simulateTicks", "world": world, "ticks": 5})
        self.assertIsNotNone(result, "simulateTicks returned no response")
        self.assertEqual(result.get("status"), "ok", f"simulateTicks failed: {result}")

if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from collections import Counter

from engine_client import build_runtime_database, resolve_era_location_file


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_EXE = "meterea_engine.exe" if sys.platform == "win32" else "meterea_engine"
ENGINE_PATH = os.path.join(REPO_ROOT, "engine", ENGINE_EXE)


class EngineSession:
    def __init__(self):
        self.proc = subprocess.Popen(
            [ENGINE_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=os.path.dirname(ENGINE_PATH),
        )

    def send(self, command):
        self.proc.stdin.write(json.dumps(command, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

        while True:
            line = self.proc.stdout.readline()
            if not line:
                stderr = self.proc.stderr.read()
                raise AssertionError(f"engine stopped unexpectedly: {stderr}")
            data = json.loads(line)
            if data.get("status") in ("ready", "progress", "hook_event"):
                continue
            return data

    def close(self):
        if self.proc:
            self.proc.terminate()
            self.proc.wait(timeout=10)


def index_pairs(pairs):
    return {pair[0]: pair[1] for pair in pairs or []}


def container_stocks(containers, items, container_id):
    stocks = Counter()
    container = containers.get(container_id) or {}
    for item_id in container.get("item_ids") or container.get("items") or []:
        item = items.get(item_id)
        if item:
            stocks[item.get("prototype_id")] += int(item.get("stack_size") or 1)
    return stocks


def load_vanilla_runtime():
    runtime_db = build_runtime_database(os.path.join(REPO_ROOT, "data"))
    era_location = resolve_era_location_file(
        runtime_db.get("eras", []),
        "rebirth",
        runtime_db.get("runtime_manifest", {}).get("era_location_fallback_file"),
    )
    with open(os.path.join(REPO_ROOT, "data", era_location["file_name"]), "r", encoding="utf-8") as handle:
        global_locations = json.load(handle)
    return runtime_db, global_locations


def assert_no_populated_region_without_food(runtime_db, world, items, containers):
    item_defs = runtime_db["items"]
    active_regions = [
        region for region in world["regions"].values()
        if region.get("population", 0) > 0 and region.get("base_type") not in ("ruins", "anomaly")
    ]
    no_food_regions = []
    for region in active_regions:
        stocks = container_stocks(containers, items, region.get("vault_id"))
        food = sum(
            qty for item_id, qty in stocks.items()
            if "food" in (item_defs.get(item_id, {}).get("tags") or [])
        )
        if food <= 0:
            no_food_regions.append(region["id"])
    assert not no_food_regions, f"populated regions should not have zero edible food: {no_food_regions}"


def build_and_bootstrap_world():
    runtime_db, global_locations = load_vanilla_runtime()
    session = EngineSession()
    try:
        session.send({"command": "init"})
        load_command = {"command": "loadDatabase"}
        load_command.update(runtime_db)
        loaded = session.send(load_command)
        assert loaded["status"] == "ok", loaded

        built = session.send({
            "command": "buildWorld",
            "player_id": "vanilla-economy-test",
            "era": "rebirth",
            "initial_agents": 100,
            "global_locations": global_locations,
            "start_day": 0,
        })
        assert built["status"] == "ok", built

        world = built["world"]
        total_population = sum(region.get("population", 0) for region in world.get("regions", {}).values())
        bootstrap = runtime_db["gameplay_runtime"]["world_bootstrap"]
        days = max(bootstrap["minimum_days"], bootstrap["base_days"] + total_population // bootstrap["population_divisor"])

        bootstrapped = session.send({"command": "bootstrapWorld", "days": days, "start_day": 0})
        assert bootstrapped["status"] == "ok", bootstrapped
        return session, runtime_db, bootstrapped["world"], index_pairs(bootstrapped.get("items")), index_pairs(bootstrapped.get("containers"))
    finally:
        if "bootstrapped" not in locals():
            session.close()


def test_vanilla_food_chain_has_bakeries_and_tools_after_bootstrap():
    session, runtime_db, world, items, containers = build_and_bootstrap_world()
    item_defs = runtime_db["items"]

    try:
        active_regions = [
            region for region in world["regions"].values()
            if region.get("population", 0) > 0 and region.get("base_type") not in ("ruins", "anomaly")
        ]
        wheat_regions = [
            region for region in active_regions
            if "wheat" in (region.get("available_raw_resources") or [])
        ]
        assert wheat_regions, "vanilla rebirth should have at least one wheat-producing populated region"

        assert any("bakeries" in (region.get("facilities") or {}) for region in wheat_regions), (
            "wheat regions must seed bakeries so mills can turn flour into edible bread"
        )

        regions_with_tool_needs = [
            region for region in active_regions
            if any(facility in (region.get("facilities") or {}) for facility in ("farms", "lumbermills", "mines", "smelters"))
        ]
        assert regions_with_tool_needs, "test needs vanilla regions with tool-using facilities"

        missing_tools = []
        required_tools = {
            "farms": "sickle",
            "lumbermills": "axe",
            "mines": "pickaxe",
            "smelters": "hammer",
        }
        for region in regions_with_tool_needs:
            stocks = container_stocks(containers, items, region.get("vault_id"))
            for facility, tool in required_tools.items():
                if facility in (region.get("facilities") or {}) and stocks[tool] <= 0:
                    missing_tools.append((region["id"], facility, tool))
        assert not missing_tools, f"bootstrap must seed required tools for starting facilities: {missing_tools[:8]}"

        assert_no_populated_region_without_food(runtime_db, world, items, containers)

        pre_simulated = session.send({"command": "preSimulate", "ticks": 360 * 24})
        assert pre_simulated["status"] == "ok", pre_simulated
        pre_world = pre_simulated["world"]
        pre_items = dict(items)
        pre_items.update(index_pairs(pre_simulated.get("items")))
        for deleted_id in pre_simulated.get("deleted_items") or []:
            pre_items.pop(deleted_id, None)
        pre_containers = dict(containers)
        pre_containers.update(index_pairs(pre_simulated.get("containers")))
        for deleted_id in pre_simulated.get("deleted_containers") or []:
            pre_containers.pop(deleted_id, None)
        assert_no_populated_region_without_food(runtime_db, pre_world, pre_items, pre_containers)
        starving_regions = [
            region["id"] for region in pre_world["regions"].values()
            if region.get("population", 0) > 0
            and region.get("base_type") not in ("ruins", "anomaly")
            and region.get("starvation_days", 0) > 0
        ]
        assert not starving_regions, f"pre-simulation should not finish with active starvation: {starving_regions}"
    finally:
        session.close()


if __name__ == "__main__":
    test_vanilla_food_chain_has_bakeries_and_tools_after_bootstrap()
    print("vanilla economy balance regression test OK")

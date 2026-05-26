#!/usr/bin/env python3
import json
import os
import subprocess
import sys


ENGINE_EXE = "meterea_engine.exe" if sys.platform == "win32" else "meterea_engine"
ENGINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ENGINE_EXE)


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
            if data.get("status") == "progress":
                continue
            return data

    def close(self):
        if self.proc.stdin:
            self.proc.stdin.close()
        stderr = self.proc.stderr.read() if self.proc.stderr else ""
        self.proc.wait(timeout=10)
        return stderr


def index_pairs(pairs):
    return {pair[0]: pair[1] for pair in pairs}


def minimal_trek_database(trek_config=None):
    return {
        "command": "loadDatabase",
        "items": {},
        "recipes": [],
        "facilities": {},
        "biomes": [
            {
                "numeric_id": 0,
                "id": "plains",
                "name": "Plains",
                "movement_cost": 1,
                "is_water": False,
                "color_hex": "#55aa55",
                "tags": []
            }
        ],
        "city_gen": {},  # CityGen удалён; ключ оставлен для совместимости с парсером
        "monsters": [],
        "disasters": [],
        "races": [],
        "professions": [],
        "traits": [],
        "npc_names": {},
        "faction_relations": {},
        "world_config": {},
        "tag_defaults": {},
        "trek_config": trek_config or {}
    }


def minimal_trek_world():
    region = {
        "id": "start_region",
        "name": "Start Region",
        "factionId": "",
        "population": 10,
        "moneySupply": 0,
        "vault_id": "",
        "threat_level": 0,
        "weather": "Clear",
        "weatherDaysLeft": 3,
        "markets": {},
        "market_square": [],
        "caravans": [],
        "facilities": {},
        "available_raw_resources": []
    }
    destination_region = {
        **region,
        "id": "destination_region",
        "name": "Destination Region"
    }
    return {
        "tick": 0,
        "current_day": 0,
        "era": "test",
        "time": {
            "accumulatedMinutes": 0,
            "lastEventPulse": 0,
            "internalHour": 0
        },
        "homeostasis": {
            "warWeariness": 0,
            "fertility": 1.0,
            "peaceBoredom": 0
        },
        "regions": {
            "start_region": region,
            "destination_region": destination_region
        },
        "factions": {},
        "npcs": {},
        "businesses": {},
        "news": [],
        "intrigues": [],
        "nexusData": {},
        "ships": [],
        "fleets": [],
        "monsters": [],
        "port_facilities": {},
        "subLocations": {},
        "map": {
            "width": 6,
            "height": 1,
            "generation_tick": 0,
            "version": 2,
            "grid": [
                [0, 0, 0, 0, False, 0],
                [0, 0, 0, 0, False, 0],
                [0, 0, 0, 0, False, 0],
                [0, 0, 0, 0, False, 0],
                [0, 0, 0, 0, False, 0],
                [0, 0, 0, 0, False, 0]
            ],
            "locations": {
                "start_region": {
                    "id": "start_region",
                    "name": "Start",
                    "x": 0,
                    "y": 0,
                    "type": "city",
                    "faction": "",
                    "no_road": False
                },
                "destination_region": {
                    "id": "destination_region",
                    "name": "Destination",
                    "x": 5,
                    "y": 0,
                    "type": "city",
                    "faction": "",
                    "no_road": False
                }
            },
            "roads": [],
            "disasters": []
        },
        "player_trek": {},
        "needsGlobalEvent": False,
        "lastDirectInjectionDay": 0
    }


def minimal_shipyard_world(order_type):
    return {
        "tick": 0,
        "current_day": 0,
        "era": "test",
        "time": {
            "accumulatedMinutes": 0,
            "lastEventPulse": 0,
            "internalHour": 0
        },
        "homeostasis": {
            "warWeariness": 0,
            "fertility": 1.0,
            "peaceBoredom": 0
        },
        "regions": {
            "port_region": {
                "id": "port_region",
                "name": "Port Region",
                "factionId": "",
                "population": 10,
                "moneySupply": 0,
                "vault_id": "",
                "threat_level": 0,
                "weather": "Clear",
                "weatherDaysLeft": 3,
                "markets": {},
                "market_square": [],
                "caravans": [],
                "facilities": {},
                "available_raw_resources": ["fish"]
            }
        },
        "factions": {},
        "npcs": {},
        "businesses": {},
        "news": [],
        "intrigues": [],
        "nexusData": {},
        "ships": [],
        "fleets": [],
        "monsters": [],
        "port_facilities": {
            "port_region": {
                "level": 1,
                "durability": 100,
                "type": "TRADE",
                "dock_container_id": "",
                "docked_ship_ids": [],
                "is_blockaded": False,
                "has_shipyard": True,
                "build_queue": [
                    {
                        "id": "order_1",
                        "type": order_type,
                        "days_left": 1,
                        "owner_id": "test_owner"
                    }
                ]
            }
        },
        "subLocations": {},
        "map": {
            "width": 1,
            "height": 1,
            "generation_tick": 0,
            "version": 2,
            "grid": [
                [0, 0, 0, 0, False, 0]
            ],
            "locations": {},
            "roads": [],
            "disasters": []
        },
        "player_trek": {},
        "needsGlobalEvent": False,
        "lastDirectInjectionDay": 0
    }


def minimal_required_tag_defaults_items():
    return {
        "food_stub": {
            "name": "Food",
            "basePrice": 1,
            "tags": ["food"],
            "properties": {}
        },
        "gold_stub": {
            "name": "Gold",
            "basePrice": 10,
            "tags": ["currency"],
            "properties": {}
        },
        "weapon_stub": {
            "name": "Weapon",
            "basePrice": 25,
            "tags": ["weapon"],
            "properties": {}
        },
        "luxury_stub": {
            "name": "Luxury",
            "basePrice": 50,
            "tags": ["luxury"],
            "properties": {}
        }
    }


def minimal_required_tag_defaults():
    return {
        "food": "food_stub",
        "currency": "gold_stub",
        "weapon": "weapon_stub",
        "luxury": "luxury_stub"
    }


def minimal_shipyard_build_world():
    return {
        "tick": 0,
        "current_day": 0,
        "era": "test",
        "time": {
            "accumulatedMinutes": 0,
            "lastEventPulse": 0,
            "internalHour": 0
        },
        "homeostasis": {
            "warWeariness": 0,
            "fertility": 1.0,
            "peaceBoredom": 0
        },
        "regions": {
            "port_region": {
                "id": "port_region",
                "name": "Port Region",
                "factionId": "owner_faction",
                "population": 10,
                "moneySupply": 0,
                "vault_id": "",
                "threat_level": 0,
                "weather": "Clear",
                "weatherDaysLeft": 3,
                "markets": {},
                "market_square": [],
                "caravans": [],
                "facilities": {},
                "available_raw_resources": ["fish"]
            }
        },
        "factions": {
            "owner_faction": {
                "id": "owner_faction",
                "name": "Owner",
                "rulerId": "",
                "regions": ["port_region"],
                "relations": {},
                "diplomacy": {},
                "truceUntil": {},
                "warType": "peace",
                "warExhaustion": 0,
                "rulerMood": 50,
                "stability": 70,
                "legitimacy": 70,
                "warGoal": "",
                "activeWarGoal": {},
                "ultimatums": [],
                "coalitions": [],
                "pendingPeaceOffers": [],
                "armyDoctrine": "balanced"
            }
        },
        "npcs": {},
        "businesses": {},
        "news": [],
        "intrigues": [],
        "nexusData": {},
        "ships": [],
        "fleets": [],
        "monsters": [],
        "port_facilities": {
            "port_region": {
                "level": 1,
                "durability": 100,
                "type": "TRADE",
                "dock_container_id": "",
                "docked_ship_ids": [],
                "is_blockaded": False,
                "has_shipyard": True,
                "build_queue": []
            }
        },
        "subLocations": {},
        "map": {
            "width": 1,
            "height": 1,
            "generation_tick": 0,
            "version": 2,
            "grid": [
                [0, 0, 0, 0, False, 0]
            ],
            "locations": {},
            "roads": [],
            "disasters": []
        },
        "player_trek": {},
        "needsGlobalEvent": False,
        "lastDirectInjectionDay": 0
    }


def test_gameplay_runtime_drives_inventory_defaults():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            "command": "loadDatabase",
            "items": {
                "gold": {
                    "name": "Gold",
                    "basePrice": 10,
                    "tags": ["currency"],
                    "properties": {},
                }
            },
            "recipes": [],
            "facilities": {},
            "biomes": [],
            "city_gen": {},  # CityGen удалён; ключ оставлен для совместимости с парсером
            "monsters": [],
            "disasters": [],
            "races": [],
            "professions": [],
            "traits": [],
            "npc_names": {},
            "faction_relations": {},
            "world_config": {},
            "tag_defaults": {
                "currency": "gold"
            },
            "gameplay_runtime": {
                "inventory_engine": {
                    "id_prefixes": {
                        "container": "crate_",
                        "item": "loot_"
                    }
                },
                "inventory": {
                    "default_lock_difficulty": 77,
                    "default_container_health": 333,
                    "non_flammable_container_types": ["bandit_stash"]
                },
                "currency": {
                    "physical_weights": {
                        "gold": 0.125
                    }
                }
            }
        })
        assert load_result["status"] == "ok"

        create_container_result = session.send({
            "command": "inventoryCommand",
            "action": "createContainer",
            "args": {
                "type": "bandit_stash",
                "ownerId": "bandits",
                "maxWeight": 50,
                "maxSlots": 8,
                "location": {
                    "region_id": "test_region"
                }
            }
        })
        assert create_container_result["status"] == "ok"
        container_id = create_container_result["containerId"]

        create_item_result = session.send({
            "command": "inventoryCommand",
            "action": "createItem",
            "args": {
                "prototypeId": "gold",
                "quantity": 3,
                "containerId": container_id
            }
        })
        assert create_item_result["status"] == "ok"
        item_id = create_item_result["itemId"]

        update_item_result = session.send({
            "command": "inventoryCommand",
            "action": "updateItemStat",
            "args": {
                "itemId": item_id,
                "stat": "durability",
                "change": 0
            }
        })
        assert update_item_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr

    containers = index_pairs(create_container_result.get("containers", []))
    items = index_pairs(update_item_result.get("items", []))

    assert container_id.startswith("crate_"), container_id
    assert item_id.startswith("loot_"), item_id

    container = containers[container_id]
    assert container["lock_data"]["difficulty"] == 77, container
    assert container["physical_props"]["health"] == 333, container
    assert container["physical_props"]["flammable"] is False, container

    item = items[item_id]
    assert item["custom_props"]["weight_per_unit"] == 0.125, item


def test_init_loads_default_item_registry_from_engine_workdir():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "Failed to open data/economy_items.json" not in stderr, stderr


def test_container_type_descriptors_drive_container_defaults():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            "command": "loadDatabase",
            "items": {},
            "recipes": [],
            "facilities": {},
            "biomes": [],
            "city_gen": {},  # CityGen удалён; ключ оставлен для совместимости с парсером
            "monsters": [],
            "disasters": [],
            "races": [],
            "professions": [],
            "traits": [],
            "npc_names": {},
            "faction_relations": {},
            "world_config": {},
            "tag_defaults": {},
            "gameplay_runtime": {
                "inventory": {
                    "default_lock_difficulty": 10,
                    "default_container_health": 200,
                    "non_flammable_container_types": []
                }
            },
            "container_types": {
                "bandit_stash": {
                    "is_locked": True,
                    "health": 451,
                    "lock_difficulty": 23,
                    "flammable": False,
                    "capacity": 7,
                    "max_weight": 61
                }
            }
        })
        assert load_result["status"] == "ok"

        create_container_result = session.send({
            "command": "inventoryCommand",
            "action": "createContainer",
            "args": {
                "type": "bandit_stash",
                "ownerId": "bandits",
                "location": {
                    "region_id": "test_region"
                }
            }
        })
        assert create_container_result["status"] == "ok"
        container_id = create_container_result["containerId"]
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    containers = index_pairs(create_container_result.get("containers", []))
    container = containers[container_id]

    assert container["lock_data"]["is_locked"] is True, container
    assert container["lock_data"]["difficulty"] == 23, container
    assert container["physical_props"]["health"] == 451, container
    assert container["physical_props"]["flammable"] is False, container
    assert container["max_slots"] == 7, container
    assert container["max_weight_kg"] == 61, container


def test_transport_registry_resolves_transport_without_item_properties():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            "command": "loadDatabase",
            "items": {
                "wagon": {
                    "name": "Wagon",
                    "basePrice": 500,
                    "tags": ["vehicle", "transport"],
                    "properties": {}
                }
            },
            "recipes": [],
            "facilities": {},
            "biomes": [],
            "city_gen": {},  # CityGen удалён; ключ оставлен для совместимости с парсером
            "monsters": [],
            "disasters": [],
            "races": [],
            "professions": [],
            "traits": [],
            "npc_names": {},
            "faction_relations": {},
            "world_config": {},
            "tag_defaults": {},
            "transport_registry": {
                "wagon": {
                    "id": "wagon",
                    "speedMultiplier": 1.7,
                    "cargoBonus": 44,
                    "waterOnly": False
                }
            }
        })
        assert load_result["status"] == "ok"

        create_container_result = session.send({
            "command": "inventoryCommand",
            "action": "createContainer",
            "args": {
                "type": "player_backpack",
                "ownerId": "player",
                "maxWeight": 50,
                "maxSlots": 8,
                "location": {
                    "region_id": "test_region"
                }
            }
        })
        assert create_container_result["status"] == "ok"
        container_id = create_container_result["containerId"]

        create_item_result = session.send({
            "command": "inventoryCommand",
            "action": "createItem",
            "args": {
                "prototypeId": "wagon",
                "quantity": 1,
                "containerId": container_id
            }
        })
        assert create_item_result["status"] == "ok"
        item_id = create_item_result["itemId"]

        mount_result = session.send({
            "command": "transportCommand",
            "action": "mount",
            "args": {
                "itemId": item_id,
                "backpackContainerId": container_id
            }
        })
        assert mount_result["status"] == "ok"

        info_result = session.send({
            "command": "transportCommand",
            "action": "getInfo",
            "args": {}
        })
        assert info_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    assert mount_result["success"] is True, mount_result
    assert "wagon" in mount_result.get("feedback", ""), mount_result
    assert info_result["info"]["transport_type"] == "wagon", info_result
    assert info_result["info"]["speed_multiplier"] == 1.7, info_result
    assert info_result["info"]["cargo_bonus"] == 44, info_result
    assert info_result["info"]["water_only"] is False, info_result


def test_trek_config_drives_start_trek_timing_and_bandit_seed():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send(minimal_trek_database({
            "base_travel_speed": 1.0,
            "bandit_cooldown_hours": 9
        }))
        assert load_result["status"] == "ok"

        sync_result = session.send({
            "command": "syncState",
            "world": minimal_trek_world(),
            "items": [],
            "containers": []
        })
        assert sync_result["status"] == "ok"

        start_result = session.send({
            "command": "startTrek",
            "start_id": "start_region",
            "destination_id": "destination_region"
        })
        assert start_result["status"] == "ok"

        full_state = session.send({"command": "getFullState"})
        assert full_state["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    assert start_result["total_hours"] == 5, start_result
    assert full_state["world"]["player_trek"]["hours_since_last_bandit"] == 9, full_state


def test_trek_config_drives_bandit_cooldown_threshold_during_ticks():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send(minimal_trek_database({
            "base_travel_speed": 1.0,
            "bandit_cooldown_hours": 2
        }))
        assert load_result["status"] == "ok"

        sync_result = session.send({
            "command": "syncState",
            "world": minimal_trek_world(),
            "items": [],
            "containers": []
        })
        assert sync_result["status"] == "ok"

        start_result = session.send({
            "command": "startTrek",
            "start_id": "start_region",
            "destination_id": "destination_region"
        })
        assert start_result["status"] == "ok"

        tick_result = session.send({
            "command": "simulateTicks",
            "ticks": 1
        })
        assert tick_result["status"] == "ok"

        full_state = session.send({"command": "getFullState"})
        assert full_state["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    assert full_state["world"]["player_trek"]["elapsed_hours"] == 1, full_state
    assert full_state["world"]["player_trek"]["hours_since_last_bandit"] == 2, full_state


def test_ship_types_drive_shipyard_merchant_capacity_and_speed():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            **minimal_trek_database(),
            "items": minimal_required_tag_defaults_items(),
            "tag_defaults": minimal_required_tag_defaults(),
            "ship_types": {
                "ship_types": [
                    {
                        "id": "merchant",
                        "speed": 2.75,
                        "capacity": 321,
                        "combat_power": 5,
                        "is_monster": False
                    }
                ]
            }
        })
        assert load_result["status"] == "ok"

        sync_result = session.send({
            "command": "syncState",
            "world": minimal_shipyard_world("MERCHANT"),
            "items": [],
            "containers": []
        })
        assert sync_result["status"] == "ok"

        tick_result = session.send({
            "command": "simulateTicks",
            "ticks": 24
        })
        assert tick_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    ships = [ship for ship in tick_result["world"]["ships"] if ship["type"] == "MERCHANT"]
    assert ships, tick_result["world"]["ships"]
    ship = ships[0]
    assert ship["type"] == "MERCHANT", ship
    assert ship["cargo_capacity"] == 321, ship
    assert ship["speed"] == 2.75, ship


def test_ship_types_drive_build_ship_days_from_gm_intervention():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            **minimal_trek_database(),
            "items": {
                **minimal_required_tag_defaults_items(),
                "building_stub": {"name": "Wood", "basePrice": 1, "tags": ["building"], "properties": {}},
                "metal_stub": {"name": "Iron", "basePrice": 1, "tags": ["metal_ingot"], "properties": {}},
                "cloth_stub": {"name": "Cloth", "basePrice": 1, "tags": ["cloth"], "properties": {}}
            },
            "tag_defaults": {
                **minimal_required_tag_defaults(),
                "building": "building_stub",
                "metal_ingot": "metal_stub",
                "cloth": "cloth_stub"
            },
            "ship_types": {
                "ship_types": [
                    {
                        "id": "merchant",
                        "build_days": 3,
                        "build_cost": {
                            "building": 2,
                            "metal_ingot": 1,
                            "cloth": 0,
                            "weapon": 0,
                            "currency": 0
                        }
                    }
                ]
            }
        })
        assert load_result["status"] == "ok"

        sync_result = session.send({
            "command": "syncState",
            "world": minimal_shipyard_build_world(),
            "items": [],
            "containers": []
        })
        assert sync_result["status"] == "ok"

        create_container_result = session.send({
            "command": "inventoryCommand",
            "action": "createContainer",
            "args": {
                "type": "faction_vault",
                "ownerId": "owner_faction",
                "maxWeight": 1000,
                "maxSlots": 100,
                "location": {"region_id": "port_region"}
            }
        })
        assert create_container_result["status"] == "ok"
        vault_id = create_container_result["containerId"]

        for prototype_id, quantity in (("building_stub", 5), ("metal_stub", 5)):
            create_item_result = session.send({
                "command": "inventoryCommand",
                "action": "createItem",
                "args": {
                    "prototypeId": prototype_id,
                    "quantity": quantity,
                    "containerId": vault_id
                }
            })
            assert create_item_result["status"] == "ok"

        full_state = session.send({"command": "getFullState"})
        assert full_state["status"] == "ok"
        world = full_state["world"]
        world["regions"]["port_region"]["vault_id"] = vault_id

        sync_with_vault_result = session.send({
            "command": "syncState",
            "world": world,
            "items": full_state.get("items", []),
            "containers": full_state.get("containers", [])
        })
        assert sync_with_vault_result["status"] == "ok"

        intervention_result = session.send({
            "command": "gmIntervention",
            "args": {
                "command": "buildShip",
                "args": {
                    "regionId": "port_region",
                    "shipType": "MERCHANT",
                    "ownerId": "owner_faction"
                }
            }
        })
        assert intervention_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    queue = intervention_result["world"]["port_facilities"]["port_region"]["build_queue"]
    assert queue, intervention_result["world"]["port_facilities"]["port_region"]
    assert queue[0]["type"] == "MERCHANT", queue[0]
    assert queue[0]["days_left"] == 3, queue[0]


def test_ship_types_drive_war_galley_stats_via_build_ship_gm_intervention():
    session = EngineSession()
    try:
        init_result = session.send({"command": "init"})
        assert init_result["status"] == "ok"

        load_result = session.send({
            **minimal_trek_database(),
            "items": {
                **minimal_required_tag_defaults_items(),
                "building_stub": {"name": "Wood", "basePrice": 1, "tags": ["building"], "properties": {}},
                "metal_stub": {"name": "Iron", "basePrice": 1, "tags": ["metal_ingot"], "properties": {}},
                "cloth_stub": {"name": "Cloth", "basePrice": 1, "tags": ["cloth"], "properties": {}}
            },
            "tag_defaults": {
                **minimal_required_tag_defaults(),
                "building": "building_stub",
                "metal_ingot": "metal_stub",
                "cloth": "cloth_stub"
            },
            "ship_types": {
                "ship_types": [
                    {
                        "id": "war_galley",
                        "build_days": 1,
                        "build_cost": {
                            "building": 1,
                            "metal_ingot": 1,
                            "cloth": 0,
                            "weapon": 0,
                            "currency": 0
                        },
                        "capacity": 77,
                        "speed": 1.9,
                        "hull": 260,
                        "sailors": 55,
                        "cannons": 13,
                        "marines": 27
                    }
                ]
            }
        })
        assert load_result["status"] == "ok"

        sync_result = session.send({
            "command": "syncState",
            "world": minimal_shipyard_build_world(),
            "items": [],
            "containers": []
        })
        assert sync_result["status"] == "ok"

        create_container_result = session.send({
            "command": "inventoryCommand",
            "action": "createContainer",
            "args": {
                "type": "faction_vault",
                "ownerId": "owner_faction",
                "maxWeight": 1000,
                "maxSlots": 100,
                "location": {"region_id": "port_region"}
            }
        })
        assert create_container_result["status"] == "ok"
        vault_id = create_container_result["containerId"]

        for prototype_id, quantity in (("building_stub", 5), ("metal_stub", 5)):
            create_item_result = session.send({
                "command": "inventoryCommand",
                "action": "createItem",
                "args": {
                    "prototypeId": prototype_id,
                    "quantity": quantity,
                    "containerId": vault_id
                }
            })
            assert create_item_result["status"] == "ok"

        full_state = session.send({"command": "getFullState"})
        assert full_state["status"] == "ok"
        world = full_state["world"]
        world["regions"]["port_region"]["vault_id"] = vault_id

        sync_with_vault_result = session.send({
            "command": "syncState",
            "world": world,
            "items": full_state.get("items", []),
            "containers": full_state.get("containers", [])
        })
        assert sync_with_vault_result["status"] == "ok"

        intervention_result = session.send({
            "command": "gmIntervention",
            "args": {
                "command": "buildShip",
                "args": {
                    "regionId": "port_region",
                    "shipType": "WAR_GALLEY",
                    "ownerId": "owner_faction"
                }
            }
        })
        assert intervention_result["status"] == "ok"

        tick_result = session.send({
            "command": "simulateTicks",
            "ticks": 24
        })
        assert tick_result["status"] == "ok"
    finally:
        stderr = session.close()

    assert "DATA ERROR" not in stderr, stderr
    ships = [ship for ship in tick_result["world"]["ships"] if ship["type"] == "WAR_GALLEY"]
    assert ships, tick_result["world"]["ships"]
    ship = ships[0]
    assert ship["cargo_capacity"] == 77, ship
    assert ship["speed"] == 1.9, ship
    assert ship["hull"] == 260, ship
    assert ship["sailors"] == 55, ship
    assert ship["cannons"] == 13, ship
    assert ship["marines"] == 27, ship


if __name__ == "__main__":
    test_gameplay_runtime_drives_inventory_defaults()
    test_init_loads_default_item_registry_from_engine_workdir()
    test_container_type_descriptors_drive_container_defaults()
    test_transport_registry_resolves_transport_without_item_properties()
    test_trek_config_drives_start_trek_timing_and_bandit_seed()
    test_trek_config_drives_bandit_cooldown_threshold_during_ticks()
    test_ship_types_drive_shipyard_merchant_capacity_and_speed()
    test_ship_types_drive_build_ship_days_from_gm_intervention()
    test_ship_types_drive_war_galley_stats_via_build_ship_gm_intervention()
    print("gameplay runtime inventory tests passed")

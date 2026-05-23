#!/usr/bin/env python3
import os
import sys


ENGINE_PATH = os.path.join(os.path.dirname(__file__), "meterea_engine.cpp")


def main():
    with open(ENGINE_PATH, "r", encoding="utf-8") as handle:
        content = handle.read()

    forbidden_snippets = [
        'createItem("bread", r.population * 0.15, r.vault_id, 0, "Bootstrap");',
        'createItem("meat", r.population * 0.05, r.vault_id, 0, "Bootstrap");',
        'createItem("wood", 200 + thread_safe_rand() % 200, r.vault_id, 0, "Bootstrap");',
        'createItem("iron_ore", 100 + thread_safe_rand() % 200, r.vault_id, 0, "Bootstrap");',
        'createItem("gold_ingot", 500 + thread_safe_rand() % 500, r.vault_id, 0, "Bootstrap");',
        'createItem("weapons", 50 + thread_safe_rand() % 50, r.vault_id, 0, "Bootstrap");',
        'else if (gt == "bread") {',
        'else if (gt == "gold_ingot") {',
        'r.facilities["farms"] = {isElf ? 15 : (rand() % 6) + 3, 100};',
        'r.facilities["mines"] = {isDwarf ? 20 : rand() % 5, 100};',
        'std::vector<std::string> monopolyTypes = {"mines", "lumbermills", "farms"};',
        'if (facType == "mines") { b.production_focus = "iron_ore"; g_world.regions[capital].available_raw_resources.insert("iron_ore"); }',
        'else if (facType == "lumbermills") { b.production_focus = "wood"; g_world.regions[capital].available_raw_resources.insert("wood"); }',
        'else if (facType == "farms") { b.production_focus = "wheat"; g_world.regions[capital].available_raw_resources.insert("wheat"); }',
        'if (r.placement_type == "mountain") {\n'
        '            r.available_raw_resources.insert((rand() % 100 < 30) ? "gold_ore" : "iron_ore");\n'
        '            r.available_raw_resources.insert("ether_dust");\n'
        '            r.available_raw_resources.insert("stone");',
    ]

    found = [snippet for snippet in forbidden_snippets if snippet in content]
    assert not found, "Bootstrap hardcodes still present in target cluster:\n" + "\n".join(found)
    print("bootstrap cluster refactor test passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(str(error))
        sys.exit(1)

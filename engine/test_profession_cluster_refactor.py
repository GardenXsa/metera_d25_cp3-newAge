#!/usr/bin/env python3
import os
import sys


ENGINE_PATH = os.path.join(os.path.dirname(__file__), "meterea_engine.cpp")


def main():
    with open(ENGINE_PATH, "r", encoding="utf-8") as handle:
        content = handle.read()

    forbidden_snippets = [
        'if (npc.profession == "Farmer" && r.facilities.count("farms") && r.facilities["farms"].level > 0) {',
        '} else if (npc.profession == "Hunter" && r.facilities.count("hunting_lodges") && r.facilities["hunting_lodges"].level > 0) {',
        '} else if (npc.profession == "Beekeeper" && r.facilities.count("apiaries") && r.facilities["apiaries"].level > 0) {',
        '} else if (npc.profession == "Fisherman" && r.facilities.count("fisheries") && r.facilities["fisheries"].level > 0) {',
        'if (npc.profession == "Astronomer" && r.facilities.count("observatories") && r.facilities["observatories"].level > 0) {',
        'if (npc.profession == "Blacksmith") reqFacility = "forges";',
        'else if (npc.profession == "Weaver") reqFacility = "weavers";',
        'else if (npc.profession == "Baker") reqFacility = "bakeries";',
        'else if (npc.profession == "Jeweler") reqFacility = "jewelers";',
        'else if (npc.profession == "Alchemist") reqFacility = "alchemists";',
        'else if (npc.profession == "Tailor") reqFacility = "tailors";',
        'double raceModMeat = (npc.race == "orc") ? 1.5 : 1.0;',
        'if (npc.race == "dwarf" && (recipe.facility == "forges" || recipe.facility == "smelters")) raceMod = 1.3;',
        'if (npc.race == "elf" && (recipe.facility == "alchemists" || recipe.facility == "jewelers")) raceMod = 1.2;',
        'double raceMod = (npc.race == "elf") ? 1.2 : 1.0;',
        'offer.good == getMappedId("bread") || offer.good == getMappedId("meat") || offer.good == getMappedId("fish")',
        'offer.good == "wax" || offer.good == "herbs"',
    ]

    found = [snippet for snippet in forbidden_snippets if snippet in content]
    assert not found, "Profession/service hardcodes still present:\n" + "\n".join(found)
    print("profession cluster refactor test passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(str(error))
        sys.exit(1)

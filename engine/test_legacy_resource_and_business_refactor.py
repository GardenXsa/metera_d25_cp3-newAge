#!/usr/bin/env python3
import os
import sys


ENGINE_PATH = os.path.join(os.path.dirname(__file__), "meterea_engine.cpp")


def main():
    with open(ENGINE_PATH, "r", encoding="utf-8") as handle:
        content = handle.read()

    forbidden_snippets = [
        'r.available_raw_resources = {"iron_ore", "gold_ore", "meat"};',
        'r.available_raw_resources = {"wood", "herbs", "cotton", "meat"};',
        'r.available_raw_resources = {"iron_ore", "herbs"};',
        'r.available_raw_resources = {"fish", "wood", "herbs"};',
        'r.available_raw_resources = {"wheat", "cotton", "wood", "meat"};',
        'if (bus.facility_type == "farms") possible_products = {"wheat", "meat", "cotton", "herbs"};',
        'else if (bus.facility_type == "fisheries") possible_products = {"fish"};',
        'else if (bus.facility_type == "lumbermills") possible_products = {"wood"};',
        'else if (bus.facility_type == "mines") possible_products = {"iron_ore", "gold_ore", "stone"};',
        'else if (bus.facility_type == "apiaries") possible_products = {"honey", "wax"};',
        'else if (bus.facility_type == "hunting_lodges") possible_products = {"fur", "meat"};',
        'else if (bus.facility_type == "observatories") possible_products = {"ether_dust"};',
        'bool isExtractor = (bus.facility_type == "farms" || bus.facility_type == "lumbermills" || bus.facility_type == "mines" || bus.facility_type == "apiaries" || bus.facility_type == "hunting_lodges" || bus.facility_type == "observatories" || bus.facility_type == "fisheries");'
    ]

    found = [snippet for snippet in forbidden_snippets if snippet in content]
    assert not found, "Legacy resource/business hardcodes still present:\n" + "\n".join(found)
    print("legacy resource and business refactor test passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(str(error))
        sys.exit(1)

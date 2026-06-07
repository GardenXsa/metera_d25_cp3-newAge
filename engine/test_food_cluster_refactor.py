#!/usr/bin/env python3
import os
import sys


ENGINE_PATH = os.path.join(os.path.dirname(__file__), "meterea_engine.cpp")


def main():
    with open(ENGINE_PATH, "r", encoding="utf-8") as handle:
        content = handle.read()

    forbidden_snippets = [
        'int foodPrice = r.markets.count(getMappedId("bread")) ? (int)r.markets[getMappedId("bread")] : 5;',
        'int breadAvailable = countItemsInContainer(r.vault_id, "bread");',
        'int armyBread = countItemsInContainer(a.supply_chest_id, "bread");',
        'globalFood += vaultStocks[rId]["bread"] +',
        'int food = countItemsInContainer(r.vault_id, "bread")',
        'region.reserveTargets["bread"] =',
        'region.reserveTargets["meat"] =',
        'region.reserveTargets["wheat"] =',
        'if (vaultStocks["bread"] < reserveBread)',
        'if (gt == "bread" || gt == "meat" || gt == "fish" || gt == "wheat") baseDemand *= 2.0;',
        'if (gt == "bread" || gt == "meat" || gt == "fish" || gt == "wheat") baseDemand *= 0.5;'
    ]

    found = [snippet for snippet in forbidden_snippets if snippet in content]
    assert not found, "Food hardcodes still present in target cluster:\n" + "\n".join(found)
    print("food cluster refactor test passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(str(error))
        sys.exit(1)

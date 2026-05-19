# Proposal: Migrating to a Tag-Based Architecture

Based on our analysis, here is a proposed design to refactor the engine to a flexible, data-driven, tag-based system. This will make the engine highly moddable, as requested.

## 1. Core Concepts

We will move from **compile-time enums** to a **runtime registry**.

-   **Old Way**: `enum GoodType { BREAD, MEAT, ... };` The engine only knows about items that are compiled into it.
-   **New Way**: A central `ItemRegistry` loads item definitions from JSON files at startup. Mods can add their own JSON files to add new items without touching the engine code.

## 2. New Data Structures

We will introduce a new primary data structure for items in `meterea_engine.cpp`.

```cpp
#include <string>
#include <vector>
#include <unordered_map>
#include <variant>

// A flexible property value
using PropertyValue = std::variant<int, double, std::string>;

struct ItemTemplate {
    std::string id;                 // "bread", "magic_sword_of_gemini"
    std::string name;               // "Bread" (base name, could be localized later)
    double basePrice = 1.0;

    // The core of the new system
    std::vector<std::string> tags;  // e.g., ["food", "consumable", "bakery"]

    // For specific data
    std::unordered_map<std::string, PropertyValue> properties; // e.g., {{"nutrition", 10.0}, {"weight", 0.5}}
};
```

This `ItemTemplate` will replace the need for `GoodType` enums, `BASE_PRICES`, `GOOD_CATEGORIES`, etc.

## 3. The `ItemRegistry`

A new global object will manage all item templates.

```cpp
class ItemRegistry {
public:
    void loadItemsFromJSON(const std::string& filePath);

    const ItemTemplate* getTemplate(const std::string& id) const;

    std::vector<const ItemTemplate*> findTemplatesWithTag(const std::string& tag) const;
    std::vector<const ItemTemplate*> findTemplatesWithAllTags(const std::vector<std::string>& tags) const;

private:
    std::unordered_map<std::string, ItemTemplate> templates;
};

// A global instance will be available
extern ItemRegistry g_itemRegistry;
```

**How it works:**
1.  At startup, the engine will call `g_itemRegistry.loadItemsFromJSON()` for `data/economy_items.json` and any JSON files found in a `mods/{mod_name}/items/` directory.
2.  All game logic will then use this registry to get item data.

## 4. Refactoring Example: NPC Buys Food

Let's look at the NPC shopping logic (around line 5916 in `meterea_engine.cpp`).

**Current Logic:**
```cpp
// Hardcoded checks for specific food items
if (npc.needs.hunger < 50) {
    shoppingList.push_back(getMappedId("bread"));
}
if (npc.needs.hunger < 30) {
    shoppingList.push_back(getMappedId("meat"));
}
```

**New Logic:**
```cpp
// Flexible, tag-based check
if (npc.needs. hunger < 50) {
    // Find all items with the "food_consumable" tag
    auto edibleItems = g_itemRegistry.findTemplatesWithTag("food_consumable");

    // Maybe the NPC has a preference? Or just picks the cheapest?
    // For now, let's say they just want the first thing they see.
    if (!edibleItems.empty()) {
        // Find the best food item based on some logic (e.g., price, nutrition)
        // For simplicity, let's just add the first one to the shopping list.
        const ItemTemplate* chosenFood = edibleItems[0]; // Simplified logic
        shoppingList.push_back(chosenFood->id);
    }
}
```
This new logic will automatically work with *any* item a mod adds, as long as it has the `"food_consumable"` tag. No engine code changes needed for new food types!

## 5. Changes to Data Files

`data/economy_items.json` will be updated to support the new structure.

**Current `bread` entry:**
```json
"bread": {
    "names": { "rebirth": "Хлеб", ... },
    "basePrice": 5,
    "category": "consumable"
}
```

**Proposed `bread` entry:**
```json
"bread": {
    "name": "Хлеб",
    "basePrice": 5,
    "tags": ["food", "consumable", "processed_food", "bakery_product"],
    "properties": {
        "nutrition": 25.0,
        "spoil_rate": 0.1,
        "weight": 0.5
    }
}
```

## Implementation Plan

1.  **Step 1: Implement `ItemTemplate` and `ItemRegistry`**. We'll add the new classes to the engine but won't use them yet. We'll also write the JSON loading logic.
2.  **Step 2: Deprecate `generate_data.py`**. We will modify it to do nothing, or simply remove it from the build process. We will check `generated_data.h` into the repository temporarily to avoid breaking everything at once.
3.  **Step 3: Refactor one system.** We'll pick one system (like NPC food consumption) and fully convert it to use the new `ItemRegistry`. We will remove the old hardcoded logic for that system.
4.  **Step 4: Repeat.** We will repeat step 3 for all other systems in the engine (crafting, economy, etc.) until `GoodType` and `generated_data.h` are no longer used anywhere.
5.  **Step 5: Clean up.** Once no code depends on them, `generated_data.h` and the old logic can be completely deleted.

This approach allows for an incremental and safe migration, with the engine remaining functional at every step.

---

Do you approve of this design and implementation plan?

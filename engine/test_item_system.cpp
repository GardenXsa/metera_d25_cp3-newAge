#include "item_system.h"
#include <iostream>
#include <cassert>

// Forward declaration of the global registry
extern ItemRegistry g_itemRegistry;

void test_load_and_get() {
    std::cout << "Running test: test_load_and_get..." << std::endl;
    
    // The test executable will be in engine/, so the path is relative to that
    g_itemRegistry.loadItemsFromJSON("../data/items.json");
    
    const ItemTemplate* bread = g_itemRegistry.getTemplate("bread");
    assert(bread != nullptr && "Bread template should be found");
    assert(bread->name == "Хлеб" && "Name should match");
    assert(bread->basePrice == 5 && "Price should match");
    assert(bread->tags.size() == 4 && "Should have 4 tags");
    assert(bread->tags[0] == "food" && "First tag should be 'food'");
    
    const ItemTemplate* non_existent = g_itemRegistry.getTemplate("non_existent_item");
    assert(non_existent == nullptr && "Non-existent item should not be found");
    
    std::cout << "PASSED: test_load_and_get" << std::endl;
}

int main() {
    test_load_and_get();
    return 0;
}

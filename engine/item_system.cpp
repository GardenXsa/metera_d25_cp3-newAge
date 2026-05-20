#include "item_system.h"
#include <fstream>
#include <iostream>

// Definition of the global registry instance
ItemRegistry g_itemRegistry;

void ItemRegistry::loadItemsFromJSON(const std::string& filePath) {
    std::ifstream f(filePath);
    if (!f.is_open()) {
        std::cerr << "Failed to open " << filePath << std::endl;
        return;
    }

    try {
        json data = json::parse(f);

        for (auto& [id, item_data] : data.items()) {
            ItemTemplate t;
            t.id = id;
            t.name = item_data.value("name", "");
            t.basePrice = item_data.value("basePrice", 1.0);
            
            if (item_data.contains("tags")) {
                item_data.at("tags").get_to(t.tags);
            }
            
            if (item_data.contains("properties")) {
                for(auto& [prop_key, prop_val] : item_data["properties"].items()) {
                    if (prop_val.is_number_integer()) {
                        t.properties[prop_key] = prop_val.get<int>();
                    } else if (prop_val.is_number()) {
                        t.properties[prop_key] = prop_val.get<double>();
                    } else if (prop_val.is_string()) {
                        t.properties[prop_key] = prop_val.get<std::string>();
                    }
                }
            }
            templates[id] = t;
        }
    } catch (const json::parse_error& e) {
        std::cerr << "JSON parse error in " << filePath << ": " << e.what() << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Error loading " << filePath << ": " << e.what() << std::endl;
    }
}

const ItemTemplate* ItemRegistry::getTemplate(const std::string& id) const {
    auto it = templates.find(id);
    if (it != templates.end()) {
        return &it->second;
    }
    return nullptr;
}

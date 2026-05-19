#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <variant>
#include "../vendor/nlohmann/json.hpp" // Use corrected path from Task 1 fix

using json = nlohmann::json;

// A flexible property value
using PropertyValue = std::variant<int, double, std::string>;

struct ItemTemplate {
    std::string id;
    std::string name;
    double basePrice = 1.0;
    std::vector<std::string> tags;
    std::unordered_map<std::string, PropertyValue> properties;

    bool hasTag(const std::string& tag) const {
        return std::find(tags.begin(), tags.end(), tag) != tags.end();
    }
};

class ItemRegistry {
public:
    void loadItemsFromJSON(const std::string& filePath);
    void addItemTemplate(const ItemTemplate& tpl) { templates[tpl.id] = tpl; }
    const ItemTemplate* getTemplate(const std::string& id) const;
    std::vector<const ItemTemplate*> findTemplatesWithTag(const std::string& tag) const {
        std::vector<const ItemTemplate*> result;
        for (auto const& [id, tpl] : templates) {
            if (tpl.hasTag(tag)) result.push_back(&tpl);
        }
        return result;
    }

private:
    std::unordered_map<std::string, ItemTemplate> templates;
};

// Global instance available to the whole engine
extern ItemRegistry g_itemRegistry;

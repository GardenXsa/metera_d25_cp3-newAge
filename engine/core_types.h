#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <optional>
#include <algorithm>
#include <future>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <functional>
#include <atomic>
#include "json_wrapper.h"

struct OrderData {
    std::string issuer_id;
    std::string issuer_name;
    std::string item_prototype;
    int quantity = 0;
    int max_price_per_unit = 0;
    int deadline_days = 0;
    std::string status;
    int created_date = 0;
    std::string target_container_id;
};

struct PhysicalItemHistory {
    int day;
    std::string event;
    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("day", day);
        obj.set("event", event);
        return obj;
    }
};

struct PhysicalItemFlags {
    bool quest_item = false;
    std::string bound_to_owner = "";
    bool stolen = false;
    bool magical = false;
    bool bound = false;
};

struct PhysicalItem {
    std::string id;
    std::string prototype_id;
    std::string raw_prototype_id;
    int stack_size = 0;
    std::string container_id;
    std::string slot_index;
    std::string state = "idle";
    PhysicalItemFlags flags;
    bool quest_item = false;
    bool bound = false;
    bool stolen = false;
    bool magical = false;
    int durability = 100;
    JsonValue custom_props = JsonValue::object();
    int created_at = 0;
    int last_moved_at = 0;
    int batch_day = 0;
    std::vector<PhysicalItemHistory> history;
    bool is_dirty = false;
    std::optional<OrderData> order_data;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("prototype_id", prototype_id);
        obj.set("stack_size", stack_size);
        obj.set("container_id", container_id);
        obj.set("slot_index", slot_index);
        obj.set("state", state);
        obj.set("durability", durability);
        obj.set("custom_props", custom_props);
        obj.set("created_at", created_at);
        obj.set("last_moved_at", last_moved_at);
        obj.set("batch_day", batch_day);
        return obj;
    }

    static PhysicalItem fromJson(const JsonValue& j) {
        PhysicalItem item;
        if(j.has("id")) item.id = j["id"].asString();
        if(j.has("prototype_id")) item.prototype_id = j["prototype_id"].asString();
        if(j.has("stack_size")) item.stack_size = j["stack_size"].asInt();
        if(j.has("container_id")) item.container_id = j["container_id"].asString();
        if(j.has("slot_index")) item.slot_index = j["slot_index"].asString();
        if(j.has("state")) item.state = j["state"].asString();
        if(j.has("durability")) item.durability = j["durability"].asInt();
        if(j.has("custom_props")) item.custom_props = j["custom_props"];
        if(j.has("created_at")) item.created_at = j["created_at"].asInt();
        if(j.has("last_moved_at")) item.last_moved_at = j["last_moved_at"].asInt();
        if(j.has("batch_day")) item.batch_day = j["batch_day"].asInt();
        return item;
    }
};

struct Storage {
    std::string id;
    std::string type;
    std::string owner_id;
    int max_weight_kg = 0;
    int max_slots = 0;
    JsonValue location = JsonValue::object();
    JsonValue lock_data = JsonValue::object();
    JsonValue physical_props = JsonValue::object();
    JsonValue custom_props = JsonValue::object();
    std::vector<std::string> item_ids;
    std::unordered_map<std::string, std::vector<std::string>> items_by_type;
    std::unordered_map<std::string, int> cached_stocks;
    bool is_dirty = false;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", type);
        obj.set("owner_id", owner_id);
        obj.set("max_weight_kg", max_weight_kg);
        obj.set("max_slots", max_slots);
        obj.set("location", location);
        obj.set("lock_data", lock_data);
        obj.set("physical_props", physical_props);
        obj.set("custom_props", custom_props);
        JsonValue arr = JsonValue::array();
        for(const auto& i : item_ids) arr.push(i);
        obj.set("item_ids", arr);
        obj.set("items", arr); // Alias for JS compatibility
        return obj;
    }

    static Storage fromJson(const JsonValue& j) {
        Storage s;
        if(j.has("id")) s.id = j["id"].asString();
        if(j.has("type")) s.type = j["type"].asString();
        if(j.has("owner_id")) s.owner_id = j["owner_id"].asString();
        if(j.has("max_weight_kg")) s.max_weight_kg = j["max_weight_kg"].asInt();
        if(j.has("max_slots")) s.max_slots = j["max_slots"].asInt();
        if(j.has("location")) s.location = j["location"];
        if(j.has("lock_data")) s.lock_data = j["lock_data"];
        if(j.has("physical_props")) s.physical_props = j["physical_props"];
        if(j.has("custom_props")) s.custom_props = j["custom_props"];
        if(j.has("item_ids") && j["item_ids"].type == JsonValue::ARRAY) {
            for(size_t i=0; i<j["item_ids"].size(); ++i) {
                s.item_ids.push_back(j["item_ids"][i].asString());
            }
        } else if(j.has("items") && j["items"].type == JsonValue::ARRAY) {
            for(size_t i=0; i<j["items"].size(); ++i) {
                s.item_ids.push_back(j["items"][i].asString());
            }
        }
        return s;
    }
};

struct FacilityTemplate {
    std::string id;
    std::unordered_map<std::string, std::string> names;
    std::vector<std::string> tags;
    int base_maintenance = 50;
    int max_employees_per_level = 100;
    int build_cost = 500;
    std::string required_tool;
    std::string resource_multiplier_type;
    std::unordered_map<std::string, double> extraction_rates;
    std::unordered_map<std::string, double> race_modifiers;
    std::unordered_map<std::string, double> weather_modifiers;

    bool hasTag(const std::string& tag) const {
        return std::find(tags.begin(), tags.end(), tag) != tags.end();
    }
};

class FacilityRegistry {
public:
    std::unordered_map<std::string, FacilityTemplate> templates;
    void clear() { templates.clear(); }
    void addTemplate(const FacilityTemplate& tpl) { templates[tpl.id] = tpl; }
    const FacilityTemplate* getTemplate(const std::string& id) const {
        auto it = templates.find(id);
        if (it != templates.end()) return &it->second;
        return nullptr;
    }
    const std::unordered_map<std::string, FacilityTemplate>& getAll() const { return templates; }
};

template<typename T>
struct ObjectPool {
    std::vector<T> data;
    std::vector<bool> active;
    std::unordered_map<std::string, size_t> id_to_index;

    bool count(const std::string& id) const {
        return id_to_index.count(id) > 0 && active[id_to_index.at(id)];
    }

    T& operator[](const std::string& id) {
        if (id_to_index.count(id)) {
            return data[id_to_index[id]];
        }
        size_t idx = data.size();
        id_to_index[id] = idx;
        data.push_back(T{});
        active.push_back(true);
        data.back().id = id;
        return data.back();
    }

    void erase(const std::string& id) {
        if (id_to_index.count(id)) {
            active[id_to_index[id]] = false;
            id_to_index.erase(id);
        }
    }

    void clear() {
        data.clear();
        active.clear();
        id_to_index.clear();
    }
};

class ThreadPool {
public:
    explicit ThreadPool(size_t num_threads = 0) : stop(false) {
        if (num_threads == 0) num_threads = std::thread::hardware_concurrency();
        if (num_threads == 0) num_threads = 4;
        for (size_t i = 0; i < num_threads; ++i) {
            workers.emplace_back([this] { workerLoop(); });
        }
    }

    ~ThreadPool() {
        {
            std::lock_guard<std::mutex> lock(queue_mutex);
            stop = true;
        }
        condition.notify_all();
        for (auto& w : workers) {
            if (w.joinable()) w.join();
        }
    }

    template<class F>
    auto enqueue(F&& f) -> std::future<decltype(f())> {
        auto task = std::make_shared<std::packaged_task<decltype(f())()>>(std::forward<F>(f));
        std::future<decltype(f())> res = task->get_future();
        {
            std::lock_guard<std::mutex> lock(queue_mutex);
            tasks.push([task]() { (*task)(); });
        }
        condition.notify_one();
        return res;
    }

private:
    void workerLoop() {
        while (true) {
            std::function<void()> task;
            {
                std::unique_lock<std::mutex> lock(queue_mutex);
                condition.wait(lock, [this] { return stop || !tasks.empty(); });
                if (stop && tasks.empty()) return;
                task = std::move(tasks.front());
                tasks.pop();
            }
            task();
        }
    }

    std::vector<std::thread> workers;
    std::queue<std::function<void()>> tasks;
    std::mutex queue_mutex;
    std::condition_variable condition;
    bool stop;
};

inline ThreadPool* getThreadPool() {
    static ThreadPool pool;
    return &pool;
}

inline JsonValue parseJson(const std::string& s) {
    try {
        return JsonValue(nlohmann::json::parse(s));
    } catch (...) {
        return JsonValue::object();
    }
}

inline std::string locStr(const std::string& key, const std::unordered_map<std::string, std::string>& replacements = {}) {
    std::string json = "{\"loc_key\":\"" + key + "\"";
    if (!replacements.empty()) {
        json += ",\"loc_args\":{";
        bool first = true;
        for (const auto& [k, v] : replacements) {
            if (!first) json += ",";
            // Escape quotes and backslashes in values for JSON safety
            std::string escaped;
            for (char c : v) {
                if (c == '"' || c == '\\') escaped += '\\';
                escaped += c;
            }
            std::string escapedKey;
            for (char c : k) {
                if (c == '"' || c == '\\') escapedKey += '\\';
                escapedKey += c;
            }
            json += "\"" + escapedKey + "\":\"" + escaped + "\"";
            first = false;
        }
        json += "}";
    }
    json += "}";
    return json;
}

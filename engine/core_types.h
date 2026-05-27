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
    int day = 0;
    std::string event;
    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("day", day);
        obj.set("event", event);
        return obj;
    }
    static PhysicalItemHistory fromJson_static(const JsonValue& j) {
        PhysicalItemHistory h;
        if(j.has("day")) h.day = j["day"].asInt();
        if(j.has("event")) h.event = j["event"].asString();
        return h;
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
    // FIX (Issue #8): Legacy direct fields now delegate to flags struct via sync().
    // Previously, C++ used these direct fields for game logic while JS used flags.*,
    // causing a desync: C++ mutations to direct fields were invisible to JS.
    // Now: syncFlags() ensures bidirectional consistency. Direct fields are kept
    // for legacy API compatibility but always synced to/from flags struct.
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

    // Sync flags struct → direct fields (ensures C++ engine reads latest flag state)
    void syncDirectFromFlags() {
        quest_item = flags.quest_item;
        bound = flags.bound;
        stolen = flags.stolen;
        magical = flags.magical;
    }

    // Sync direct fields → flags struct (ensures legacy C++ mutations are visible to JS)
    void syncFlagsFromDirect() {
        flags.quest_item = flags.quest_item || quest_item;
        flags.bound = flags.bound || bound;
        flags.stolen = flags.stolen || stolen;
        flags.magical = flags.magical || magical;
    }

    // Full bidirectional sync — call after any mutation to either set of fields
    void syncFlags() {
        syncFlagsFromDirect();
        syncDirectFromFlags();
    }

    JsonValue toJson() const {
        // Ensure consistency before serialization: direct fields → flags
        // (mutating in toJson is not ideal, but the direct fields are legacy and
        // this is the safest place to guarantee JS sees the correct state)
        const_cast<PhysicalItem*>(this)->syncFlags();

        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("prototype_id", prototype_id);
        obj.set("raw_prototype_id", raw_prototype_id);
        obj.set("stack_size", stack_size);
        obj.set("container_id", container_id);
        obj.set("slot_index", slot_index);
        obj.set("state", state);
        obj.set("durability", durability);
        obj.set("custom_props", custom_props);
        obj.set("created_at", created_at);
        obj.set("last_moved_at", last_moved_at);
        obj.set("batch_day", batch_day);
        obj.set("is_dirty", is_dirty);
        // Flags (authoritative source of truth)
        JsonValue flagsObj = JsonValue::object();
        flagsObj.set("quest_item", flags.quest_item);
        flagsObj.set("bound", flags.bound);
        flagsObj.set("stolen", flags.stolen);
        flagsObj.set("magical", flags.magical);
        flagsObj.set("bound_to_owner", flags.bound_to_owner);
        obj.set("flags", flagsObj);
        // Legacy direct fields (kept for backward compatibility with old JS code)
        obj.set("quest_item", quest_item);
        obj.set("bound", bound);
        obj.set("stolen", stolen);
        obj.set("magical", magical);
        // Order data
        if (order_data.has_value()) {
            JsonValue od = JsonValue::object();
            od.set("issuer_id", order_data->issuer_id);
            od.set("issuer_name", order_data->issuer_name);
            od.set("item_prototype", order_data->item_prototype);
            od.set("quantity", order_data->quantity);
            od.set("max_price_per_unit", order_data->max_price_per_unit);
            od.set("deadline_days", order_data->deadline_days);
            od.set("status", order_data->status);
            od.set("created_date", order_data->created_date);
            od.set("target_container_id", order_data->target_container_id);
            obj.set("order_data", od);
        }
        // History
        if (!history.empty()) {
            JsonValue histArr = JsonValue::array();
            for (const auto& h : history) histArr.push(h.toJson());
            obj.set("history", histArr);
        }
        return obj;
    }

    static PhysicalItem fromJson(const JsonValue& j) {
        PhysicalItem item;
        if(j.has("id")) item.id = j["id"].asString();
        if(j.has("prototype_id")) item.prototype_id = j["prototype_id"].asString();
        if(j.has("raw_prototype_id")) item.raw_prototype_id = j["raw_prototype_id"].asString();
        if(j.has("stack_size")) item.stack_size = j["stack_size"].asInt();
        if(j.has("container_id")) item.container_id = j["container_id"].asString();
        if(j.has("slot_index")) item.slot_index = j["slot_index"].asString();
        if(j.has("state")) item.state = j["state"].asString();
        if(j.has("durability")) item.durability = j["durability"].asInt();
        if(j.has("custom_props")) item.custom_props = j["custom_props"];
        if(j.has("created_at")) item.created_at = j["created_at"].asInt();
        if(j.has("last_moved_at")) item.last_moved_at = j["last_moved_at"].asInt();
        if(j.has("batch_day")) item.batch_day = j["batch_day"].asInt();
        if(j.has("is_dirty")) item.is_dirty = j["is_dirty"].asBool();
        // Flags (authoritative source)
        if(j.has("flags")) {
            item.flags.quest_item = j["flags"]["quest_item"].asBool();
            item.flags.bound = j["flags"]["bound"].asBool();
            item.flags.stolen = j["flags"]["stolen"].asBool();
            item.flags.magical = j["flags"]["magical"].asBool();
            if(j["flags"].has("bound_to_owner")) item.flags.bound_to_owner = j["flags"]["bound_to_owner"].asString();
        }
        // Legacy direct fields (override flags if present)
        if(j.has("quest_item")) item.quest_item = j["quest_item"].asBool();
        if(j.has("bound")) item.bound = j["bound"].asBool();
        if(j.has("stolen")) item.stolen = j["stolen"].asBool();
        if(j.has("magical")) item.magical = j["magical"].asBool();
        // FIX (Issue #8): Bidirectional sync — ensures both sets are consistent
        item.syncFlags();
        // Order data
        if(j.has("order_data")) {
            OrderData od;
            od.issuer_id = j["order_data"]["issuer_id"].asString();
            od.issuer_name = j["order_data"]["issuer_name"].asString();
            od.item_prototype = j["order_data"]["item_prototype"].asString();
            od.quantity = j["order_data"]["quantity"].asInt();
            od.max_price_per_unit = j["order_data"]["max_price_per_unit"].asInt();
            od.deadline_days = j["order_data"]["deadline_days"].asInt();
            od.status = j["order_data"]["status"].asString();
            od.created_date = j["order_data"]["created_date"].asInt();
            od.target_container_id = j["order_data"]["target_container_id"].asString();
            item.order_data = od;
        }
        // History
        if(j.has("history")) {
            for(size_t i = 0; i < j["history"].size(); i++) {
                item.history.push_back(PhysicalItemHistory::fromJson_static(j["history"][i]));
            }
        }
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
        obj.set("is_dirty", is_dirty);
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
        if(j.has("is_dirty")) s.is_dirty = j["is_dirty"].asBool();
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
    std::vector<size_t> free_slots;  // Reusable slots from erased entries

    bool contains(const std::string& id) const {
        return id_to_index.count(id) > 0 && active[id_to_index.at(id)];
    }

    // Legacy alias
    bool count(const std::string& id) const {
        return contains(id);
    }

    T& operator[](const std::string& id) {
        if (id_to_index.count(id)) {
            return data[id_to_index[id]];
        }
        size_t idx;
        if (!free_slots.empty()) {
            // Reuse an erased slot instead of growing the vector
            idx = free_slots.back();
            free_slots.pop_back();
            data[idx] = T{};
            data[idx].id = id;
            active[idx] = true;
        } else {
            idx = data.size();
            data.push_back(T{});
            active.push_back(true);
            data.back().id = id;
        }
        id_to_index[id] = idx;
        return data[idx];
    }

    void erase(const std::string& id) {
        if (id_to_index.count(id)) {
            size_t idx = id_to_index[id];
            active[idx] = false;
            free_slots.push_back(idx);  // Make slot available for reuse
            id_to_index.erase(id);
        }
    }

    void clear() {
        data.clear();
        active.clear();
        id_to_index.clear();
        free_slots.clear();
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
    std::atomic<bool> stop;
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
            // Escape quotes, backslashes, and control characters in values for JSON safety
            std::string escaped;
            for (char c : v) {
                if (c == '"') { escaped += "\\\""; }
                else if (c == '\\') { escaped += "\\\\"; }
                else if (c == '\n') { escaped += "\\n"; }
                else if (c == '\r') { escaped += "\\r"; }
                else if (c == '\t') { escaped += "\\t"; }
                else if (static_cast<unsigned char>(c) < 0x20) { escaped += "\\u00"; escaped += "0123456789abcdef"[c >> 4]; escaped += "0123456789abcdef"[c & 0xf]; }
                else { escaped += c; }
            }
            std::string escapedKey;
            for (char c : k) {
                if (c == '"') { escapedKey += "\\\""; }
                else if (c == '\\') { escapedKey += "\\\\"; }
                else if (c == '\n') { escapedKey += "\\n"; }
                else if (c == '\r') { escapedKey += "\\r"; }
                else if (c == '\t') { escapedKey += "\\t"; }
                else if (static_cast<unsigned char>(c) < 0x20) { escapedKey += "\\u00"; escapedKey += "0123456789abcdef"[c >> 4]; escapedKey += "0123456789abcdef"[c & 0xf]; }
                else { escapedKey += c; }
            }
            json += "\"" + escapedKey + "\":\"" + escaped + "\"";
            first = false;
        }
        json += "}";
    }
    json += "}";
    return json;
}

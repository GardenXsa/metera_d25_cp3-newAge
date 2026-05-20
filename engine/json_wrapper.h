#pragma once

#include "../vendor/nlohmann/json.hpp"
#include <string>
#include <vector>
#include <map>

struct JsonValue {
    enum Type { NULL_VAL, OBJECT, ARRAY, STRING, INT, DOUBLE, BOOLEAN };
    nlohmann::json _data;
    Type type;
    std::map<std::string, JsonValue> obj_val;
    std::vector<JsonValue> arr_val;
    std::string s_val;
    long long i_val = 0;
    double d_val = 0.0;
    bool b_val = false;

    JsonValue() : _data(nullptr), type(NULL_VAL) {}
    
    JsonValue(const nlohmann::json& j) : _data(j) {
        if (j.is_object()) {
            type = OBJECT;
            for (auto& [key, val] : j.items()) {
                obj_val[key] = JsonValue(val);
            }
        } else if (j.is_array()) {
            type = ARRAY;
            for (auto& val : j) {
                arr_val.push_back(JsonValue(val));
            }
        } else if (j.is_string()) {
            type = STRING;
            s_val = j.get<std::string>();
        } else if (j.is_number_integer()) {
            type = INT;
            i_val = j.get<long long>();
        } else if (j.is_number_float()) {
            type = DOUBLE;
            d_val = j.get<double>();
        } else if (j.is_boolean()) {
            type = BOOLEAN;
            b_val = j.get<bool>();
        } else {
            type = NULL_VAL;
        }
    }

    JsonValue(const char* s) { type = STRING; s_val = s; _data = s; }
    JsonValue(const std::string& s) { type = STRING; s_val = s; _data = s; }
    JsonValue(int i) { type = INT; i_val = i; _data = i; }
    JsonValue(long long i) { type = INT; i_val = i; _data = i; }
    JsonValue(double d) { type = DOUBLE; d_val = d; _data = d; }
    JsonValue(bool b) { type = BOOLEAN; b_val = b; _data = b; }

    static JsonValue object() { return JsonValue(nlohmann::json::object()); }
    static JsonValue array() { return JsonValue(nlohmann::json::array()); }

    bool has(const std::string& key) const {
        return type == OBJECT && obj_val.count(key) > 0;
    }

    std::string asString() const { return s_val; }
    int asInt() const {
        if (type == DOUBLE) return (int)d_val;
        return (int)i_val;
    }
    double asDouble() const {
        if (type == INT) return (double)i_val;
        return d_val;
    }
    bool asBool() const {
        if (type == NULL_VAL) return false;
        if (type == INT) return i_val != 0;
        if (type == STRING) return !s_val.empty();
        return b_val;
    }

    JsonValue operator[](const std::string& key) const {
        if (has(key)) return obj_val.at(key);
        return JsonValue();
    }

    JsonValue operator[](size_t index) const {
        if (type == ARRAY && index < arr_val.size()) return arr_val[index];
        return JsonValue();
    }

    template<typename T>
    void set(const std::string& key, const T& value) {
        if (type != OBJECT) return;
        _data[key] = value;
        obj_val[key] = JsonValue(_data[key]);
    }
    
    void set(const std::string& key, const JsonValue& value) {
        if (type != OBJECT) return;
        _data[key] = value._data;
        obj_val[key] = value;
    }

    template<typename T>
    void push(const T& value) {
        if (type != ARRAY) return;
        _data.push_back(value);
        arr_val.push_back(JsonValue(_data.back()));
    }

    void push(const JsonValue& value) {
        if (type != ARRAY) return;
        _data.push_back(value._data);
        arr_val.push_back(value);
    }

    std::string toString() const { return _data.dump(); }
    size_t size() const {
        if (type == OBJECT) return obj_val.size();
        if (type == ARRAY) return arr_val.size();
        return 0;
    }
};

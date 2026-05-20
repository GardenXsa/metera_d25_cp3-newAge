/**
 * cyberpunk_economy.cpp — ModKit 3.0 Native Plugin
 *
 * Demonstrates the new Opaque C-API for native mod plugins.
 * This plugin multiplies all item prices by 2x in a "neon world" economy.
 *
 * Build:
 *   Linux:   g++ -std=c++17 -shared -fPIC -I../../engine -o cyberpunk_economy.so cyberpunk_economy.cpp
 *   Windows: zig c++ -target x86_64-windows-gnu -shared -I../../engine -o cyberpunk_economy.dll cyberpunk_economy.cpp
 */

#include "meterea_mod_sdk.h"
#include <cstdio>
#include <cstring>
#include <string>

static const MeteraAPI* g_api = nullptr;
static int32_t g_plugin_id = -1;
static double g_price_multiplier = 2.0;  // Neon world = everything costs more

// ============================================================================
// REQUIRED EXPORTS
// ============================================================================

extern "C" {

METERA_EXPORT const char* MeteraPlugin_GetName(void) {
    return "Cyberpunk Economy";
}

METERA_EXPORT const char* MeteraPlugin_GetVersion(void) {
    return "1.0.0";
}

METERA_EXPORT void MeteraPlugin_GetAPI(const MeteraAPI* api) {
    g_api = api;
}

METERA_EXPORT MeteraResult MeteraPlugin_Init(int32_t plugin_id) {
    g_plugin_id = plugin_id;
    if (g_api && g_api->log) {
        g_api->log("Cyberpunk Economy plugin initialized (ModKit 3.0 C-API)");
    }
    return METERA_OK;
}

METERA_EXPORT void MeteraPlugin_OnLoad(void) {
    if (!g_api) return;

    char msg[256];
    snprintf(msg, sizeof(msg),
             "Cyberpunk Economy: Applying %.1fx price multiplier for neon world",
             g_price_multiplier);
    g_api->log(msg);

    // Apply the price multiplier immediately on load
    MeteraResult result = g_api->multiplyAllPrices(g_price_multiplier);
    if (result == METERA_OK) {
        g_api->log("Cyberpunk Economy: All prices doubled (deferred for next tick)");
    } else {
        g_api->log("Cyberpunk Economy: ERROR - failed to multiply prices");
    }

    // Store mod info in global string store for inter-mod communication
    g_api->setGlobalString("cyberpunk:economy_multiplier",
                           std::to_string((int)g_price_multiplier).c_str());
}

METERA_EXPORT void MeteraPlugin_Shutdown(void) {
    if (g_api && g_api->log) {
        g_api->log("Cyberpunk Economy plugin shutting down");
    }
    g_api = nullptr;
    g_plugin_id = -1;
}

// ============================================================================
// OPTIONAL CALLBACK EXPORTS
// ============================================================================

METERA_EXPORT void MeteraPlugin_OnDailyTick(int32_t day) {
    if (!g_api) return;

    // Every 30 days, log world population for the neon economy
    if (day % 30 == 0) {
        int64_t pop = g_api->getWorldPopulation();
        char msg[256];
        snprintf(msg, sizeof(msg),
                 "Cyberpunk Economy [Day %d]: Neo-Veridia population: %lld",
                 day, (long long)pop);
        g_api->log(msg);
    }
}

METERA_EXPORT void MeteraPlugin_OnHourlyTick(int32_t day, int32_t hour) {
    // No hourly processing needed for economy plugin
}

} // extern "C"

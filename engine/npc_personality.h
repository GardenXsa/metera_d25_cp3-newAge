#pragma once
#include <string>
#include <random>

namespace NpcGen {
    // Data-driven NPC generation functions.
    // All name/background data comes from g_db (loaded from JSON).
    // Implementation in meterea_engine.cpp (after Database struct is defined).

    std::string generateName(const std::string& factionId, std::mt19937& gen);
    std::string generateBackground(int wealth_level, int paranoia, std::mt19937& gen);
}

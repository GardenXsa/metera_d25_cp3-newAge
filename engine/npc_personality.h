#pragma once
#include <string>
#include <vector>
#include <random>
#include <unordered_map>
#include <unordered_set>

// Forward declaration — BackgroundFragment/BackgroundCategory defined in definitions.h
struct BackgroundFragment;
struct BackgroundCategory;
struct BackgroundCompositionRules;

namespace NpcGen {
    // Legacy: simple name/background from g_db pools
    std::string generateName(const std::string& factionId, std::mt19937& gen);
    std::string generateBackground(int wealth_level, int paranoia, std::mt19937& gen);

    // === BackgroundComposer: composable backstory system ===
    struct ComposedBackground {
        std::string text;                                      // Полный текст предыстории
        std::unordered_map<std::string, int> personality_delta; // Суммарное смещение характера
        std::vector<std::string> selected_fragment_ids;        // Выбранные фрагменты (для отладки)
        std::vector<std::string> tags;                         // Все теги из выбранных фрагментов
    };

    /**
     * Собирает предысторию из фрагментов, учитывая зависимости и исключения.
     *
     * Алгоритм:
     * 1. Обязательные категории всегда включаются
     * 2. Опциональные — с вероятностью weight
     * 3. В каждой категории выбирается один фрагмент, совместимый с уже выбранными
     * 4. Совместимость: requires ⊆ selected_ids, excludes ∩ selected_ids = ∅
     * 5. Personality delta суммируется из bias'ов выбранных фрагментов
     *
     * @param categories  Категории с фрагментами (из g_db)
     * @param rules       Правила компоновки (из g_db)
     * @param gen         ГСЧ
     * @return            Собранная предыстория с характером
     */
    ComposedBackground composeBackground(
        const std::vector<BackgroundCategory>& categories,
        const BackgroundCompositionRules& rules,
        std::mt19937& gen
    );

    /**
     * Генерирует характер NPC на основе предыстории.
     *
     * Базовые значения (30-70) + смещения из personality_delta + случайный шум.
     * Результат клипится в [min_personality_value, max_personality_value].
     *
     * @param personality_delta  Смещения из ComposedBackground
     * @param rules              Правила (лимиты)
     * @param gen                ГСЧ
     * @return                   Карта: {"aggression": 42, "sociability": 65, ...}
     */
    std::unordered_map<std::string, int> generatePersonalityFromBackground(
        const std::unordered_map<std::string, int>& personality_delta,
        const BackgroundCompositionRules& rules,
        std::mt19937& gen
    );

    /**
     * Рассчитывает количество фоновых NPC для населённой локации.
     * Базовая формула: sqrt(population) * density_factor
     * Где density_factor зависит от типа локации (city: 0.3, village: 0.15, etc.)
     *
     * @param population  Население региона из C++ Region
     * @param locationType Тип локации ("city", "village", "camp", "anomaly", etc.)
     * @return            Количество NPC для генерации
     */
    int calculateBackgroundNpcCount(int population, const std::string& locationType);
}

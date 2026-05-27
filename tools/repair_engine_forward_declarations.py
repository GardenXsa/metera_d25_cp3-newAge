from pathlib import Path
import shutil

path = Path('engine/meterea_engine.cpp')
text = path.read_text(encoding='utf-8')

# FIX (Issue #12): Create backup before modifying C++ source files.
# Previously, repair scripts wrote directly with no backup — if the script
# crashed mid-write or produced malformed output, the original was lost.
backup_path = path.with_suffix(path.suffix + '.bak')
shutil.copy2(path, backup_path)
print(f'Backup created: {backup_path}')

marker = '// Forward declarations for data-architecture helper layer'
if marker in text:
    print('NOOP: helper-layer forward declarations already exist')
    raise SystemExit(0)

anchor = 'void processFarmers() {'
if anchor not in text:
    raise SystemExit('ERROR: processFarmers anchor not found')

block = r'''
// Forward declarations for data-architecture helper layer.
// These helpers are defined later in the file, but production/business systems
// above that section need their declarations for a single-file C++ build.
const ProfessionDef* getProfessionData(const NPC& npc);
std::string getNpcProfessionType(const NPC& npc);
bool npcHasProfessionType(const NPC& npc, const std::vector<std::string>& types);
bool npcHasProfessionAbility(const NPC& npc, const std::string& ability);
std::string getNpcToolItemId(const NPC& npc);
bool regionHasFacility(const Region& region, const std::string& facilityId);
double getNpcFacilityRaceModifier(const NPC& npc, const std::string& facilityId);
std::string getLegacyCraftFacilityForProfession(const NPC& npc);
std::vector<std::string> getFacilityCandidateProducts(const std::string& facilityId);
bool facilityIsExtractor(const std::string& facilityId);
const RecipeDef* getPreferredRecipeForFacilityOutput(
    const std::string& facilityId,
    const std::string& preferredOutputId,
    const std::string& requiredOutputTag
);
std::string getPreferredFacilityOutputForRegion(
    const Region& region,
    const std::string& facilityId,
    const std::string& preferredTag,
    const std::vector<std::string>& preferredIds,
    const std::vector<std::string>& preferredTags
);
inline std::string getPreferredFacilityOutputForRegion(
    const Region& region,
    const std::string& facilityId,
    const std::string& preferredTag,
    const std::vector<std::string>& preferredIds
) {
    return getPreferredFacilityOutputForRegion(region, facilityId, preferredTag, preferredIds, {});
}
void upsertNpcMarketOffer(
    Region& region,
    const std::string& sellerId,
    const std::string& goodId,
    int quantity,
    double priceMultiplier
);
inline void upsertNpcMarketOffer(
    Region& region,
    const std::string& sellerId,
    const std::string& goodId,
    int quantity
) {
    upsertNpcMarketOffer(region, sellerId, goodId, quantity, 1.0);
}
bool isInnkeeperFoodItem(const std::string& itemId);
bool isClericSupplyItem(const std::string& itemId);

'''

text = text.replace(anchor, block + anchor, 1)
path.write_text(text, encoding='utf-8')
print('OK: inserted helper-layer forward declarations before processFarmers')

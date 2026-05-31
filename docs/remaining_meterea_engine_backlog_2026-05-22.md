# Remaining `meterea_engine.cpp` Backlog

Date: `2026-05-22`
**Закрыт: `2026-05-25`** — все пункты выполнены в ходе Phase 9 Engine Cleanup.

---

## ✅ Все пункты закрыты

| # | Описание | Статус | Коммит |
|---|---|---|---|
| 1 | NPC food consumption legacy fallback (`bread` literal ~3688) | ✅ Закрыт | `08279c5` |
| 2 | Currency/weight/item bootstrap (`gold_ingot` ~4169, ~5409) | ✅ Закрыт | ранее |
| 3 | Region economy/repair literals (`weapons`, `boards`, `gold_ingot` ~5208) | ✅ Закрыт | ранее |
| 4 | Military/siege supply literals (`bread`, `weapons`, `gold_ingot` ~5944, ~6372...) | ✅ Закрыт | `08279c5` |
| 5 | Naval/shipbuilding port upgrade literals (`boards`, `cloth`, `stone` ~6165, ~8575) | ✅ Закрыт | `7410863` |
| 6 | Trade/diplomacy `gold_ingot` (~7369, ~7478, ~9679...) | ✅ Закрыт | ранее |
| 7 | English profession names в NPC assignment (~9782–9799) | ✅ Закрыт | `08279c5` |
| 8 | Leadership/naval role name literals (`Admiral`, `Sailor`, `General` ~6013, ~6284) | ✅ Закрыт | ранее (`npcHasProfessionType`) |
| 9 | Brothel/bathhouse luxury hardcoded (`aphrodisiac`, `lingerie`, `perfume` ~6855) | ✅ Закрыт | ранее (`getCoreIdsByTagList`) |
| 10 | Helper-layer legacy mappings (`inferRegionRawResourcesLegacy` и др.) | ✅ Закрыт | `e8ca738` (shims удалены/externalized) |
| 11 | Profession-driven production data-native (`preferred_facility`) | ✅ Закрыт | `08279c5` + `e8ca738` |

## Дополнительно закрыто в Phase 9

- `vaultStocks["bread"]` (siege) → `getCoreIdByTag("food")` — `08279c5`
- `vaultStocks["weapons"]` (army deploy) → `getCoreIdByTag("weapon")` — `10ad2fa`
- `profession == "Merchant"` → `npcHasProfessionType` — `10ad2fa`
- `breadPrice = 5` fallback → `g_db.items[f_id].basePrice` — `10ad2fa`
- Port build costs `stoneCost=2000`, `woodCost=1000` → `g_gameplay_runtime.*` — `7410863`
- stapleFoodId inline hints → `tag_defaults["reserve_priority_hints"]` — `e8ca738`
- `getLegacyCraftFacilityForProfession` dead shim удалён — `e8ca738`
- `biome_legacy_numeric_ids` → `world_config.json` — `e8ca738`

## Итоговая зелёная точка

```
Smoke check:            60 checks, 0 failed, 0 warnings
test_stub_game.js:      80 PASSED, 0 FAILED
engine/test_*.py:       все PASS
meterea_engine.exe:     скомпилирован 2026-05-25, g++ 15.2.0, 0 ошибок
```

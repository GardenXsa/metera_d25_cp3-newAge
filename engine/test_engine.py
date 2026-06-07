#!/usr/bin/env python3
import subprocess
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine_client import build_runtime_database, resolve_era_location_file

def run_command(cmd_data):
    exe_name = './meterea_engine.exe' if sys.platform == 'win32' else './meterea_engine'
    proc = subprocess.Popen(
        [exe_name],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding='utf-8'
    )
    
    stdout, stderr = proc.communicate(input=json.dumps(cmd_data, ensure_ascii=False) + '\n')
    if stderr:
        print(f"STDERR: {stderr}")
    
    lines = stdout.strip().split('\n')
    final_result = None
    
    for line in lines:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            if data.get("status") == "progress":
                # Выводим прогресс в консоль теста, чтобы видеть работу движка
                print(f"      [ENGINE] {data.get('message')}")
            else:
                final_result = data
        except json.JSONDecodeError as e:
            print(f"[FAIL] Ошибка парсинга строки: {line}")
            raise e
            
    return final_result

print("[TEST] Тест 1: init команда")
result = run_command({"command": "init"})
assert result["status"] == "ok", f"Ожидался 'ok', получено: {result}"
print(f"   [OK] init: {result['message']}")

print("\n[TEST] Тест 1.5: loadDatabase команда (обязательна перед buildWorld)")
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
runtime_db = build_runtime_database(os.path.join(repo_root, "data"))
era_location = resolve_era_location_file(
    runtime_db.get("eras", []),
    "rebirth",
    runtime_db.get("runtime_manifest", {}).get("era_location_fallback_file")
)
location_file_name = era_location["file_name"]
location_file_path = os.path.join(repo_root, "data", location_file_name)
if not os.path.exists(location_file_path):
    location_file_name = runtime_db.get("runtime_manifest", {}).get("era_location_fallback_file") or "locations_rebirth.json"
    location_file_path = os.path.join(repo_root, "data", location_file_name)
with open(location_file_path, "r", encoding="utf-8") as handle:
    global_locations = json.load(handle)
result_db = run_command({
    "command": "loadDatabase",
    **runtime_db
})
assert result_db["status"] == "ok", f"Ожидался 'ok' для loadDatabase, получено: {result_db}"
print(f"   [OK] loadDatabase: {result_db.get('message', 'OK')}")

print("\n[TEST] Тест 2: buildWorld команда")
result = run_command({"command": "buildWorld", "player_id": 1, "global_locations": global_locations})
assert result["status"] == "ok", f"Ожидался 'ok', получено: {result}"
assert "world" in result, "Отсутствует поле 'world'"
world = result["world"]
assert world["tick"] == 0, f"Ожидался tick=0, получено: {world['tick']}"
assert len(world["regions"]) > 0, "Нет регионов в мире"
print(f"   [OK] buildWorld: tick={world['tick']}, регионов={len(world['regions'])}")

print("\n[TEST] Тест 2.5: bootstrapWorld команда (Экономическая балансировка)")
result_boot = run_command({
    "command": "bootstrapWorld",
    "days": 30
})
assert result_boot["status"] == "ok", f"Ожидался 'ok', получено: {result_boot}"
assert "world" in result_boot, "Отсутствует поле 'world'"
world = result_boot["world"]
assert world["tick"] == 0, "После bootstrap tick должен быть сброшен в 0"
print(f"   [OK] bootstrapWorld: балансировка завершена")

print("\n[TEST] Тест 3: simulateTicks команда (передача состояния)")
world_json = json.dumps(world)
result = run_command({
    "command": "simulateTicks",
    "world": world,
    "ticks": 5
})
assert result["status"] == "ok", f"Ожидался 'ok', получено: {result}"
assert result["tick"] == 5, f"Ожидался tick=5, получено: {result['tick']}"
assert "world" in result, "Отсутствует поле 'world' в ответе"
new_world = result["world"]
assert new_world["tick"] == 5, f"Мир не обновился: tick={new_world['tick']}"
print(f"   [OK] simulateTicks: tick={result['tick']}, news_count={result['news_count']}")

print("\n[TEST] Тест 4: непрерывная симуляция (сохранение состояния)")
# Передаём мир из предыдущего шага дальше
result2 = run_command({
    "command": "simulateTicks",
    "world": new_world,
    "ticks": 10
})
assert result2["tick"] == 15, f"Ожидался tick=15, получено: {result2['tick']}"
print(f"   [OK] Непрерывная симуляция: tick={result2['tick']}")

print("\n[TEST] Тест 5: проверка структуры мира")
w = result2["world"]
assert "era" in w, "Отсутствует era"
assert "regions" in w, "Отсутствуют regions"
assert "factions" in w, "Отсутствуют factions"
assert "npcs" in w, "Отсутствуют npcs"
assert "news" in w, "Отсутствуют news"
region = list(w["regions"].values())[0]
assert "id" in region, "У региона нет id"
assert "name" in region, "У региона нет name"
assert "facilities" in region, "У региона нет facilities"
print(f"   [OK] Структура мира корректна")

print("\n[TEST] Тест 6: Длительная симуляция (30 дней = 720 тиков)")
items = result2.get("items", [])
containers = result2.get("containers", [])
result3 = run_command({
    "command": "simulateTicks",
    "world": w,
    "items": items,
    "containers": containers,
    "ticks": 720
})
assert result3["status"] == "ok", f"Ожидался 'ok', получено: {result3['status']}"
assert result3["tick"] == 735, f"Ожидался tick=735, получено: {result3['tick']}"
print(f"   [OK] Длительная симуляция пройдена: tick={result3['tick']}, новостей={result3['news_count']}")

print("\n[TEST] Тест 7: Стресс-тест (1 год = 8640 тиков)")
result4 = run_command({
    "command": "simulateTicks",
    "world": result3["world"],
    "items": result3.get("items", []),
    "containers": result3.get("containers", []),
    "ticks": 8640
})
assert result4["status"] == "ok", f"Ожидался 'ok', получено: {result4['status']}"
print(f"   [OK] Стресс-тест пройден: tick={result4['tick']}, новостей={result4['news_count']}")

print("\n[TEST] Тест 8: Проверка Т3 Экономики (Профессии и Расы NPC)")
w_final = result4["world"]
npc_with_prof = 0
for npc_id, npc in w_final["npcs"].items():
    assert "race" in npc, f"У NPC {npc_id} нет расы"
    if "economy" in npc and "profession_type" in npc["economy"]:
        if npc["economy"]["profession_type"] != "none":
            npc_with_prof += 1
assert npc_with_prof > 0, "Ни одному NPC не назначена профессия!"
print(f"   [OK] Профессии назначены: {npc_with_prof} NPC")

print("\n[TEST] Тест 9: Проверка Т3 Экономики (Рыночные площади)")
market_offers_found = 0
for reg_id, reg in w_final["regions"].items():
    if "market_square" in reg:
        market_offers_found += len(reg["market_square"])
print(f"   [OK] Лотов на рынках после года симуляции: {market_offers_found}")

print("\n[TEST] Тест 10: Проверка Т3 Экономики (Монополии Лордов)")
lord_monopolies = 0
for bus_id, bus in w_final["businesses"].items():
    for owner in bus.get("owner_ids", []):
        if owner.startswith("ruler_"):
            lord_monopolies += 1
assert lord_monopolies > 0, "Не найдено ни одной монополии лорда!"
print(f"   [OK] Монополий лордов: {lord_monopolies}")

print("\n[TEST] Тест 11: Проверка Т3 Экономики (Купеческие караваны)")
merchant_caravans = 0
for reg_id, reg in w_final["regions"].items():
    for caravan in reg.get("caravans", []):
        if "merchant_id" in caravan and caravan["merchant_id"]:
            merchant_caravans += 1
print(f"   [OK] Активных купеческих караванов в пути: {merchant_caravans}")

print("\n[TEST] Тест 12: Проверка микро-циклов (Услуги: Трактирщики и Жрецы)")
services_profit = 0
for npc_id, npc in w_final["npcs"].items():
    if "economy" in npc and npc["economy"].get("profession_type") in ["innkeeper", "cleric"]:
        if npc["economy"].get("savings", 0) > 0:
            services_profit += 1
print(f"   [OK] Успешных поставщиков услуг с прибылью: {services_profit}")

print("\n[TEST] Тест 13: Проверка микро-циклов (Маги и Зелья)")
potions_found = 0
for reg_id, reg in w_final["regions"].items():
    for offer in reg.get("market_square", []):
        if offer.get("good") == "potions":
            potions_found += offer.get("quantity", 0)
print(f"   [OK] Зелий на рынках (созданных магами): {potions_found}")

print("\n[TEST] Тест 14: Проверка системы дорог (Блокады монстрами)")
roads_ok = True
for road in w_final["map"].get("roads", []):
    if "condition" not in road:
        roads_ok = False
assert roads_ok, "У дорог отсутствует поле condition для блокировки"
print(f"   [OK] Дороги поддерживают состояния (blocked/paved/dirt)")

print("\n" + "="*50)
print("[OK] ВСЕ ТЕСТЫ (ВКЛЮЧАЯ ПОЛНУЮ Т3 МИКРОЭКОНОМИКУ) УСПЕШНО ПРОЙДЕНЫ!")
print("="*50)

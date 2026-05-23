from pathlib import Path
import re

path = Path('engine/meterea_engine.cpp')
text = path.read_text(encoding='utf-8')
original = text

# 1) Ensure Database has tag_defaults field.
if 'std::unordered_map<std::string, std::string> tag_defaults;' not in text:
    anchor = '    std::unordered_map<std::string, std::string> facility_names;\n'
    if anchor not in text:
        raise SystemExit('ERROR: Database.facility_names anchor not found')
    text = text.replace(
        anchor,
        anchor + '\n    // Data-driven canonical ids by semantic tag, loaded from data/tag_defaults.json\n    std::unordered_map<std::string, std::string> tag_defaults;\n',
        1,
    )

# 2) getCoreIdByTag is placed before LOG_WARN is available in this file.
# Replace LOG_WARN(...) only inside this function with std::cerr logging.
func_match = re.search(r'std::string\s+getCoreIdByTag\s*\([^)]*\)\s*\{.*?\n\}', text, re.DOTALL)
if not func_match:
    raise SystemExit('ERROR: getCoreIdByTag function not found')
func = func_match.group(0)
func = re.sub(r'LOG_WARN\((.*?)\);', r'std::cerr << (\1) << std::endl;', func, flags=re.DOTALL)
text = text[:func_match.start()] + func + text[func_match.end():]

# 3) Repair the malformed insertion around loadDatabase items -> tag_defaults -> recipes.
# Earlier insert_after duplicated `JsonValue recipes = command["recipes"];` and left
# `g_db.items[k] = def;` outside the item loop. Replace the whole damaged gap with
# a compact valid tag_defaults loader.
tag_defaults_block = '''            // Load data-driven canonical ids by semantic tag.\n            // Only string values are interpreted here; array entries such as tax_goods_list\n            // are intentionally ignored by getCoreIdByTag and should be consumed by systems\n            // that expect lists.\n            g_db.tag_defaults.clear();\n            if (command.has("tag_defaults") && command["tag_defaults"].type == JsonValue::OBJECT) {\n                for (const auto& [tag, value] : command["tag_defaults"].obj_val) {\n                    if (value.type != JsonValue::STRING) continue;\n                    const std::string itemId = value.asString();\n                    g_db.tag_defaults[tag] = itemId;\n\n                    if (g_db.items.find(itemId) == g_db.items.end()) {\n                        std::cerr << "DATA ERROR: tag_defaults['" << tag << "'] points to missing item id '" << itemId << "'" << std::endl;\n                    }\n                }\n            } else {\n                std::cerr << "DATA WARNING: runtime database does not contain required object tag_defaults" << std::endl;\n            }\n\n            JsonValue recipes = command["recipes"];\n'''

items_pos = text.find('JsonValue items = command["items"];')
if items_pos == -1:
    raise SystemExit('ERROR: loadDatabase items block not found')

first_recipes = text.find('JsonValue recipes = command["recipes"];', items_pos)
if first_recipes == -1:
    raise SystemExit('ERROR: first recipes anchor not found after items block')

second_recipes = text.find('JsonValue recipes = command["recipes"];', first_recipes + 1)

if second_recipes != -1 and second_recipes - first_recipes < 8000:
    start = text.rfind('\n', 0, first_recipes) + 1
    end = text.find('\n', second_recipes)
    if end == -1:
        end = second_recipes + len('JsonValue recipes = command["recipes"];')
    else:
        end += 1
    text = text[:start] + tag_defaults_block + text[end:]
else:
    comment = '            // Load data-driven canonical ids by semantic tag.'
    comment_pos = text.find(comment, items_pos)
    if comment_pos != -1 and comment_pos < first_recipes:
        start = text.rfind('\n', 0, comment_pos) + 1
        end = text.find('\n', first_recipes)
        if end == -1:
            end = first_recipes + len('JsonValue recipes = command["recipes"];')
        else:
            end += 1
        text = text[:start] + tag_defaults_block + text[end:]
    else:
        # No tag_defaults loader exists yet; insert before recipes.
        start = text.rfind('\n', 0, first_recipes) + 1
        text = text[:start] + tag_defaults_block + text[start:]

# 4) Remove the failed one-shot transport helper script from the project if it exists.
failed_transport_script = Path('tools/apply_transport_data_patch.py')
if failed_transport_script.exists():
    failed_transport_script.unlink()

if text == original:
    print('NOOP: no repair changes were needed')
else:
    path.write_text(text, encoding='utf-8')
    print('OK: repaired meterea_engine.cpp tag_defaults runtime block and early logging')

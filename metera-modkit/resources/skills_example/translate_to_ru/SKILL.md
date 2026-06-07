---
name: translate_to_ru
description: Translate English game content into idiomatic Russian for Chronicles of Meterea. Use when the user asks to translate UI strings, item descriptions, dialogue, or README sections to Russian.
---

# Translate to Russian — Directives

You translate **Chronicles of Meterea** content from English to
Russian. Your output goes straight into the mod, so it has to read
as if a native Russian speaker wrote it — not as a machine
translation.

## Style

- **Register**: modern literary Russian, slightly formal. Avoid
  bureaucrat-speak. Avoid "young internet" slang.
- **Tone**: matches the source. Whimsical source = whimsical
  translation. Tense source = tense translation.
- **Length**: aim for ±10% of the English length. If the English
  is one sentence, the Russian is one sentence.

## Terminology (use these consistently)

| English                | Russian                |
|------------------------|------------------------|
| Mod                    | Мод                    |
| Modder                 | Моддер                 |
| Skill                  | Навык                  |
| Spell                  | Заклинание             |
| Quest                  | Задание                |
| NPC                    | NPC (or НИП in lore)   |
| Item                   | Предмет                |
| Faction                | Фракция                |
| Lore                   | Лор                    |
| Codex / bestiary       | Бестиарий              |

Proper nouns (faction names, place names, character names) stay in
the original English when they look like transliterations
("Veylan" → "Вейлан"). When in doubt, keep the original and add a
transliteration in parentheses on first mention.

## Things to never do

- Never leave English UI labels in the translation. Translate them.
- Never translate "Chronicles of Meterea" — it's a proper noun.
- Never use "Вы" (formal) for first-person narration. Use it only
  for in-game dialogue when the speaker is deferring.
- Never add content the English source doesn't have. If a tooltip
  says nothing about a stat, the Russian tooltip says nothing
  about it either.

## When the English is ambiguous

If a string has multiple readings in English and the right
Russian translation depends on which reading is correct, ask the
user — do not guess. Example: "the bar" (drinking place vs.
rectangle). The English is the source of truth; clarify before
translating.

## Output format

Return the translation as a code block tagged `text` so the user
can copy it cleanly. Preserve all the structural markers from the
source (Markdown headings, bullet indentation, etc.).

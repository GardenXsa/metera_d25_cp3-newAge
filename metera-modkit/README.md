# metera-modkit

> Professional CLI / TUI / AI-agent for **Chronicles of Meterea** modding.

`modkit` is the replacement for the old `ModKit.py` GUI. It runs as a
single `.exe` on Windows, macOS and Linux. It can be used in three
ways:

| Mode | How | Who it's for |
| --- | --- | --- |
| **TUI workbench** *(default when you launch `modkit`)* | full-screen interactive: mod browser, file tree, JSON editor, schema panel, validation, AI chat. | Modders who want a proper modding IDE without learning a CLI. |
| **CLI commands** | `modkit new …`, `modkit validate …`, etc. | Scripting and CI. |
| **AI agent** | `modkit agent "сделай мод с огненным мечом"` or `modkit chat`. | Players who don't want to write JSON by hand. |

Zero-config: works out of the box. The TUI is the default; the AI
agent is optional and only activates after `modkit init`.

## Highlights

* **TUI workbench** with three panes (mod list / file tree / tabs),
  live JSON syntax check, schema hints, quick-create templates, and
  an embedded AI agent chat.
* **Quick-create templates** for the most common mod types: empty,
  item, biome, recipe, class, loot table, total-conversion. Both
  `modkit new --template biome` and the TUI's *New mod* dialog use
  the same templates.
* **Three permission modes** —
  * `ask` (default) — every write / shell call asks the user;
  * `auto-edit` — reads and writes are silent, shell still asks;
  * `yolo` — never asks (use with care).
* **Three ways to talk to the AI agent**:
  * `modkit "сделай новый биом"` — single-shot task from the command
    line;
  * `modkit chat` — interactive REPL with `/mod`, `/mode`, `/reset`
    commands;
  * `modkit run task.md` — execute a task described in a markdown
    / text file;
  * TUI tab "AI" — chat right inside the workbench.
* **Pure stdlib** for the agent loop — no `requests`, no extra HTTP
  libraries. Textual powers the TUI.
* **Sandboxed** — every path is `safe_join`-guarded against
  `..`-traversal. The `read_file` / `write_file` / `edit_file` tools
  can only touch files inside the active mod.

## Install (developer mode)

```powershell
git clone <repo>
cd metera-modkit
py -m pip install -e .
py -m modkit --help
```

## Build a standalone .exe

```powershell
build.bat
dist\modkit.exe --version
```

The script installs `pyinstaller` on demand and produces
`dist\modkit.exe` (~16 MB; includes `textual` for the TUI).

## First run

```powershell
modkit                       # opens the TUI workbench
modkit init                  # interactive setup wizard (provider / model / key)
```

Non-interactive:

```powershell
modkit init --provider openai --api-key sk-... --model gpt-4o-mini
modkit init --provider anthropic --api-key sk-ant-...
modkit init --provider gemini --api-key AIza...
modkit init --provider local --base-url http://localhost:1234/v1
modkit init --provider dummy --mode yolo     # offline stub for CI / tests
```

## The TUI workbench

Just run `modkit` (no args) or `modkit tui`. Layout:

```
┌─ Header: metera-modkit · <mods root> · <provider> ─────────────────────┐
│ Mods (sidebar) │ Files (tree)  │ Editor / Schema / Validate / AI │
│                │               │                                  │
│                │               │                                  │
└─ Footer: keybindings ─────────────────────────────────────────────┘
```

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New mod (template picker) |
| `Ctrl+D` | Duplicate the active mod |
| `Delete` | Delete the active mod (or the open file) |
| `Ctrl+S` | Save the open file |
| `F5` | Validate the active mod |
| `Ctrl+E` | Export the active mod to `.zip` |
| `Ctrl+Shift+E` | Open the mod folder in the platform file manager |
| `Ctrl+L` | Focus the mods list |
| `Ctrl+T` | Focus the file tree |
| `Ctrl+R` | Refresh |
| `F1` | Help overlay |
| `Ctrl+Q` | Quit |

### Right-hand tabs

* **Editor** — TextArea with live JSON syntax check. Saves with
  `Ctrl+S`. The current file's extension is auto-detected and the
  matching tree-sitter language is used if installed.
* **Schema** — shows the relevant entry from `runtime_manifest.json`
  for the open file. Updates as you open different files.
* **Validate** — full mod contract check. Use `F5` to re-run. The
  result is also written to this tab.
* **AI** — chat with the LLM agent. The agent has access to the same
  tool set as the CLI agent and can read / write / validate the
  active mod.

### Quick-create templates

Available in both the TUI's *New mod* dialog and the CLI flag
`--template`:

| Key | What you get |
| --- | --- |
| `empty` | `mod.json` + `data/main.js` |
| `item` | + `data/items.json` with one example item |
| `biome` | + `data/biomes.json` with one example biome |
| `recipe` | + `data/economy_recipes.json` |
| `class` | + `data/classes.json` |
| `loot` | + `data/loot_tables.json` |
| `total_conversion` | a TC mod (with `total_conversion: true`) |

```powershell
modkit new my_cool_mod --template biome --name "My Cool Mod"
```

## Common CLI commands

```powershell
modkit doctor                                # sanity check
modkit providers                             # list providers
modkit docs "биомы"                          # search bundled docs
modkit docs --section recipes                # open a specific section
modkit list                                  # list installed mods
modkit new my_cool_mod --name "My Cool Mod" --template biome
modkit --mod my_cool_mod validate            # validate contract
modkit --mod my_cool_mod agent "сделай data/items.json с тремя предметами"
modkit chat                                  # REPL
modkit run task.md                           # run a task from a file
modkit tui                                   # launch TUI
```

### Global flags

| flag | description |
| --- | --- |
| `--provider <id>` | LLM provider (overrides config) |
| `--model <name>` | Model name |
| `--api-key <key>` | API key (overrides env / config) |
| `--base-url <url>` | Base URL for local / custom endpoints |
| `--mode <ask\|auto-edit\|yolo>` | Permission mode |
| `--mod <id>` | Active mod id |
| `--mods-dir <path>` | Override mods root (defaults to game's user-data folder) |
| `--max-iterations <n>` | Cap on agent tool-loop iterations |
| `--temperature <f>` | Sampling temperature |
| `--max-tokens <n>` | Max tokens per reply |
| `--no-color` | Disable ANSI colours |
| `--no-shell` | Hide the `shell` tool from the agent |
| `--json` | Output machine-readable JSON from `list` / `new` / `validate` |

## Modding contract — short version

A mod is a folder named `<id>` (lowercase ASCII letters, digits and
underscores) that lives under the mods root. It must contain a
`mod.json` and may contain `data/`, `scripts/` and any other folders.

```jsonc
{
  "id": "my_cool_mod",        // must equal the folder name
  "name": "My Cool Mod",
  "version": "1.0.0",
  "author": "you",
  "description": "short summary",
  "dependencies": ["base_game"],
  "scripts": ["data/main.js"],
  "data": {
    "biomes": ["data/biomes.json"],
    "items":  ["data/items.json"]
  }
}
```

The keys in `data` are validated against `runtime_manifest.json`. Each
entry is the relative path to a JSON file inside the mod folder.

For the full reference see the bundled `README.md` (search with
`modkit docs <query>`) or `data/README.md` in the main game repo.

## Project layout

```
metera-modkit/
├── modkit/                 # the actual library
│   ├── __main__.py         # entry point
│   ├── cli.py              # argparse + subcommands
│   ├── agent.py            # provider-agnostic tool loop
│   ├── permissions.py      # ask / auto-edit / yolo
│   ├── validate.py         # mod.json + data + manifest checks
│   ├── docs.py             # README.md + runtime_manifest indexer
│   ├── templates.py        # quick-create mod templates
│   ├── config.py           # ~/.metera-modkit/config.json
│   ├── paths.py            # frozen-aware resource / user dirs
│   ├── ui.py               # coloured output + prompts
│   ├── providers/          # 13 LLM providers (openai, anthropic, …)
│   ├── tools/              # fs, docs, mod, shell
│   └── tui/                # Textual TUI app
├── resources/              # bundled with the .exe
│   ├── README.md
│   ├── runtime_manifest.json
│   └── mod_template.json
├── tests/                  # 23 unit tests
│   ├── test_smoke.py
│   └── test_tui.py
├── build.spec              # PyInstaller spec
├── build.bat               # one-click .exe builder
└── pyproject.toml
```

## For the maintainer

* `runtime_manifest.json`, `README.md` and `mod_template.json` are
  copied into `resources/` at build time. If the source files in
  `data/` change, copy them over (or add a small `sync.py`).
* The default modding contract lives in
  `modkit/validate.py:validate_mod` and should stay aligned with
  `runtime_manifest.json`.
* New LLM providers can be added by appending a `ProviderSpec` to
  `modkit/providers/registry.py` and implementing a tiny adapter in
  `modkit/providers/`. All adapters only depend on stdlib `urllib`.
* New quick-create templates: add an entry to `TEMPLATES` in
  `modkit/templates.py` — they're picked up automatically by both
  the CLI and the TUI.

## License

All rights reserved. Chronicles of Meterea © MrKins_XP (GardenXsa).

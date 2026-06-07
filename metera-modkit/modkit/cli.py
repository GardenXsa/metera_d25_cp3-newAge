"""Command-line entry point.

We expose a single ``modkit`` binary with subcommands. The most
important ones are:

* ``modkit init``       вЂ” interactive setup wizard.
* ``modkit chat``       вЂ” REPL with the agent.
* ``modkit agent``      вЂ” one-shot task: ``modkit agent "make me a fire sword mod"``.
* ``modkit run FILE``   вЂ” execute the task described in a markdown / text file.
* ``modkit new``        вЂ” scaffold a mod folder.
* ``modkit list``       вЂ” list installed mods.
* ``modkit validate``   вЂ” run the mod-contract validator.
* ``modkit docs QUERY`` вЂ” search the bundled docs without calling any LLM.
* ``modkit providers``  вЂ” list available LLM providers.
* ``modkit doctor``     вЂ” sanity checks for config, paths, resources.

All subcommands honour the same global flags for picking the provider,
permission mode, and mod directory.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Callable


# Подсказка для PyInstaller, чтобы он гарантированно включил эти либы в .exe,
# даже если они импортируются динамически через try/except.
def _pyinstaller_imports_hack():
    import PySide6
    import textual
    import modkit.gui.main_window
    import modkit.tui.app

from modkit import __version__, config as config_mod, docs as docs_index, ui
from modkit.agent import AgentEvent, run_agent
from modkit.chat_render import event_to_record
from modkit.paths import (
    game_mods_dir,
    resolve_mods_root,
    resources_dir,
    user_config_dir,
)
from modkit.permissions import Mode, describe as describe_mode
from modkit.providers import (
    Provider,
    ProviderError,
    build_provider,
    list_providers,
)
from modkit.providers.registry import get_spec
from modkit.tools import ToolRegistry, build_default_registry
from modkit.tools.registry import ToolContext
from modkit.validate import validate_mod


def _force_utf8_io() -> None:
    """Make sure stdout/stderr can print non-ASCII text on Windows shells.

    Without this, printing Cyrillic or emoji from README.md crashes with
    UnicodeEncodeError on Python's default cp1251 / cp866 codec.
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            try:
                buffer = getattr(stream, "buffer", None)
                if buffer is not None:
                    setattr(
                        sys,
                        stream_name,
                        io.TextIOWrapper(buffer, encoding="utf-8", errors="replace"),
                    )
            except Exception:  # pragma: no cover - best-effort
                pass


# Commands that never need the engine source tree. Listed here so the
# startup hook can skip the clone/update check for them — `--doctor`
# in particular would deadlock if it tried to clone before reporting
# "engine source is missing".
_SOURCE_FREE_COMMANDS = frozenset({
    "init", "providers", "doctor", "version",
    "list", "new", "validate",
})


def _ensure_source_ready(args: argparse.Namespace) -> bool:
    """Make sure the local engine source clone is present + up to date.

    Called from :func:`main` before any command that might need the
    source tree (the agent, the TUI, the GUI, ``modkit docs``). Returns
    ``True`` when the source is usable, ``False`` when the user
    declined a prompt (the caller should print a hint and exit).

    Honours ``--no-update`` (skip the check entirely) and ``--yes``
    (auto-accept prompts; useful in CI / scripted runs).
    """
    if getattr(args, "no_update", False):
        return True
    if getattr(args, "command", None) in _SOURCE_FREE_COMMANDS:
        return True

    from modkit.source_manager import (
        SourceError,
        default_manager,
        default_spec,
    )

    spec = default_spec()
    mgr = default_manager()

    auto_yes = bool(getattr(args, "yes", False))

    def _prompt(title: str, body: str) -> bool:
        ui.header(title)
        ui.hint(body)
        if auto_yes:
            ui.hint("[--yes] авто-да")
            return True
        if _g(args, "json_output"):
            # No way to ask the user — refuse the prompt.
            return False
        return ui.confirm("продолжить?", default=False)

    def _progress(msg: str) -> None:
        if _g(args, "json_output"):
            return
        ui.hint(f"  › {msg}")

    if not mgr.is_cloned(spec):
        try:
            ok = mgr.ensure_ready(
                spec, update=False, prompt=_prompt, progress=_progress,
            )
        except SourceError as exc:
            ui.error(f"не удалось подготовить исходники: {exc}")
            ui.hint(
                "  исходники движка нужны командам, которые читают код "
                "(agent, chat, run, tui, gui, docs)."
            )
            return False
        if not ok:
            ui.warn("исходники не загружены — некоторые команды будут недоступны")
            return False
        ui.success(f"исходники {spec.display_name} готовы: {mgr.dir_for(spec)}")
        return True

    if not bool(getattr(args, "no_update", False)):
        try:
            ok = mgr.ensure_ready(
                spec, update=True, prompt=_prompt, progress=_progress,
            )
        except SourceError as exc:
            ui.warn(f"проверка обновлений не удалась: {exc}")
            ui.hint("  работаю с локальной копией")
            return True
        if not ok:
            return False
    return True


# в”Ђв”Ђ argparse construction в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


def _add_global_flags(p: argparse.ArgumentParser) -> None:
    """Add the shared flags to *p*.

    Defaults are set to ``argparse.SUPPRESS`` so when this function is used
    on a subparser through ``parents=[shared]`` an absent flag does NOT
    overwrite a value already set on the parent namespace.
    """
    SUP = argparse.SUPPRESS
    p.add_argument("--provider", default=SUP, help="LLM provider id (see `modkit providers`).")
    p.add_argument("--model", default=SUP, help="Override the model name for the chosen provider.")
    p.add_argument("--api-key", default=SUP, help="API key for the chosen provider.")
    p.add_argument("--base-url", default=SUP, help="Override base URL (useful for local LLMs / proxies).")
    p.add_argument(
        "--mode",
        choices=[m.value for m in Mode],
        default=SUP,
        help="Permission mode: ask (default), auto-edit, yolo.",
    )
    p.add_argument("--mod", default=SUP, help="Select mod id to operate on.")
    p.add_argument(
        "--mods-dir",
        default=SUP,
        help="Override mods directory (defaults to the game's user mods folder).",
    )
    p.add_argument(
        "--max-iterations",
        type=int,
        default=SUP,
        help="Maximum tool-calling rounds before the agent stops.",
    )
    p.add_argument("--no-color", action="store_true", default=SUP, help="Disable ANSI colors.")
    p.add_argument("--no-shell", action="store_true", default=SUP, help="Disable the shell tool entirely.")
    p.add_argument(
        "--no-update",
        action="store_true",
        default=SUP,
        help="Skip the engine-source update check on startup.",
    )
    p.add_argument(
        "--yes",
        "-y",
        action="store_true",
        default=SUP,
        help="Auto-answer 'yes' to startup prompts (e.g. source clone/update).",
    )
    p.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        default=SUP,
        help="Emit machine-readable JSON instead of friendly text where applicable.",
    )
    p.add_argument(
        "--temperature",
        type=float,
        default=SUP,
        help="Sampling temperature (default from config or 0.4).",
    )
    p.add_argument(
        "--max-tokens",
        type=int,
        default=SUP,
        help="Maximum tokens per LLM call (default from config or 4096).",
    )


def _g(args: argparse.Namespace, name: str, default=None):
    """Read a possibly-suppressed global flag from the namespace."""
    return getattr(args, name, default)


def build_parser() -> argparse.ArgumentParser:
    # Shared parent so global flags work BEFORE *and* AFTER the subcommand.
    shared = argparse.ArgumentParser(add_help=False)
    _add_global_flags(shared)

    parser = argparse.ArgumentParser(
        prog="modkit",
        parents=[shared],
        description=(
            "metera-modkit вЂ” CLI for creating Chronicles of Meterea mods, with an "
            "AI agent that knows the game's modding contract."
        ),
    )
    parser.add_argument("-V", "--version", action="version", version=f"metera-modkit {__version__}")

    sub = parser.add_subparsers(dest="command")

    sub.add_parser("init", parents=[shared], help="Interactive setup wizard (provider, model, API key, mode).")
    sub.add_parser("providers", parents=[shared], help="List supported LLM providers.")
    sub.add_parser("doctor", parents=[shared], help="Sanity checks for installation and config.")
    sub.add_parser("version", parents=[shared], help="Print version.")

    p_list = sub.add_parser("list", parents=[shared], help="List installed mods.")
    p_list.add_argument("--full", action="store_true", help="Show all mod.json metadata.")

    p_new = sub.add_parser("new", parents=[shared], help="Scaffold a new mod folder.")
    p_new.add_argument(
        "id",
        nargs="?",
        default=None,
        help="Mod id (lowercase letters, digits, underscores). May also be given as --id.",
    )
    p_new.add_argument(
        "--id",
        dest="id_flag",
        default=None,
        help="Same as the positional id (allows `modkit new --id foo`).",
    )
    p_new.add_argument("--name", help="Human-readable name (defaults to id).")
    p_new.add_argument("--author", default="Unknown")
    p_new.add_argument("--description", default="")
    p_new.add_argument(
        "--from-template",
        default=None,
        help="Path to a custom mod_template.json (defaults to bundled).",
    )
    p_new.add_argument(
        "--template",
        default="empty",
        help=(
            "Quick-create template: empty, item, biome, recipe, class, "
            "loot, total_conversion."
        ),
    )
    p_new.add_argument(
        "--total-conversion",
        action="store_true",
        help="Mark the mod as a total conversion (TC).",
    )

    p_validate = sub.add_parser("validate", parents=[shared], help="Validate a mod against the modding contract.")
    p_validate.add_argument("mod_id", nargs="?", help="Mod id (defaults to --mod or current).")

    p_docs = sub.add_parser("docs", parents=[shared], help="Search the bundled docs (no LLM).")
    p_docs.add_argument("query", nargs="+", help="Free-text query.")
    p_docs.add_argument("--limit", type=int, default=5)
    p_docs.add_argument("--full", action="store_true", help="Print full body of the top match.")

    p_agent = sub.add_parser("agent", parents=[shared], help="One-shot agent task.")
    p_agent.add_argument("task", nargs="+", help="Task description.")

    p_chat = sub.add_parser("chat", parents=[shared], help="Interactive chat with the agent (REPL).")
    p_chat.add_argument(
        "initial_task",
        nargs="*",
        help="Optional initial prompt (otherwise opens an empty REPL).",
    )

    p_run = sub.add_parser("run", parents=[shared], help="Execute the task described in a file.")
    sub.add_parser(
        "tui",
        parents=[shared],
        help="Launch the terminal-UI workbench (mod browser, file tree, editor, AI agent).",
    )
    sub.add_parser(
        "gui",
        parents=[shared],
        help="Launch the native Qt GUI workbench (proper desktop window).",
    )
    p_run.add_argument("file", help="Path to a .md / .txt file with the task description.")

    return parser


# в”Ђв”Ђ helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


def _apply_global_flags(cfg: config_mod.Config, args: argparse.Namespace) -> config_mod.Config:
    if _g(args, "no_color"):
        ui.set_color(False)
    if _g(args, "provider"):
        cfg.provider = _g(args, "provider")
    if _g(args, "model"):
        cfg.model = _g(args, "model")
    if _g(args, "base_url"):
        cfg.base_url = _g(args, "base_url")
    if _g(args, "api_key"):
        cfg.api_keys[cfg.provider or "_default"] = _g(args, "api_key")
    if _g(args, "mode"):
        cfg.permission_mode = _g(args, "mode")
    if _g(args, "mods_dir"):
        cfg.mods_dir = _g(args, "mods_dir")
    if _g(args, "max_iterations"):
        cfg.max_iterations = _g(args, "max_iterations")
    if _g(args, "temperature") is not None:
        cfg.temperature = _g(args, "temperature")
    if _g(args, "max_tokens") is not None:
        cfg.max_tokens = _g(args, "max_tokens")
    return cfg


def _build_runtime_context(
    cfg: config_mod.Config,
    args: argparse.Namespace,
    *,
    include_shell: bool = True,
) -> tuple[ToolRegistry, ToolContext]:
    mods_root = resolve_mods_root(cfg.mods_dir or None)
    mode = Mode.parse(cfg.permission_mode or "ask")
    mod_root: Path | None = None
    mod_id = _g(args, "mod") or ""
    if mod_id:
        candidate = mods_root / mod_id
        if not candidate.exists():
            ui.error(f"--mod '{mod_id}' not found in {mods_root}")
            raise SystemExit(2)
        mod_root = candidate
    no_shell = bool(_g(args, "no_shell"))
    registry = build_default_registry(include_shell=include_shell and not no_shell)

    json_output = bool(_g(args, "json_output"))

    def confirm(name: str, arguments: dict) -> bool:
        if json_output:
            return False
        preview = json.dumps(arguments, ensure_ascii=False, indent=2)
        if len(preview) > 800:
            preview = preview[:800] + "..."
        ui.warn(f"agent wants to run tool: {ui.bold(name)}")
        if preview.strip() != "{}":
            ui.hint(preview)
        return ui.confirm("СЂР°Р·СЂРµС€РёС‚СЊ?", default=False)

    def _ask_user(payload: dict) -> str:
        """CLI ask_user handler: present options or free-text prompt."""
        question = payload.get("question", "")
        options = payload.get("options", [])
        default_val = payload.get("default", "")
        if json_output:
            return default_val
        if options:
            default_idx = 0
            if default_val:
                for i, opt in enumerate(options):
                    val = opt.get("value", opt) if isinstance(opt, dict) else opt
                    if val == default_val:
                        default_idx = i
                        break
            chosen = ui.choose(question, options, default=default_idx)
            return options[chosen]
        return ui.ask(question, default=default_val)

    ctx = ToolContext(
        mods_root=mods_root,
        mod_root=mod_root,
        mode=mode,
        confirm=confirm,
        log=lambda msg: ui.hint(msg),
        shell_cwd=mod_root or mods_root,
        extra={"ask_user": _ask_user},
    )
    return registry, ctx


def _build_provider_from_cfg(cfg: config_mod.Config, args: argparse.Namespace) -> Provider:
    provider_id = cfg.provider or "dummy"
    try:
        spec = get_spec(provider_id)
    except ValueError as exc:
        ui.error(str(exc))
        raise SystemExit(2) from exc
    api_key = (
        _g(args, "api_key")
        or cfg.api_key_for(provider_id)
        or ("" if not spec.requires_api_key else "")
    )
    if spec.requires_api_key and not api_key:
        ui.error(
            f"provider '{provider_id}' needs an API key. Set one via `modkit init`, "
            f"`--api-key`, or the env var ${config_mod.Config._env_for(provider_id)}."
        )
        raise SystemExit(2)
    return build_provider(
        provider_id,
        api_key=api_key,
        model=cfg.model,
        base_url=cfg.base_url,
        temperature=cfg.temperature or 0.4,
        max_tokens=cfg.max_tokens or 4096,
    )


# в”Ђв”Ђ subcommand handlers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


def cmd_init(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    """Interactive or non-interactive setup wizard.

    Non-interactive: pass ``--provider`` (and optionally ``--model``,
    ``--api-key``, ``--base-url``, ``--mode``) on the command line. The
    wizard is then skipped and the config is saved immediately. This is
    the recommended flow for CI / scripted installs.
    """
    non_interactive = bool(_g(args, "provider")) or not sys.stdin.isatty()

    if non_interactive:
        specs = list_providers()
        chosen_id = _g(args, "provider") or cfg.provider or "openai"
        try:
            chosen = next(s for s in specs if s.id == chosen_id)
        except StopIteration:
            ui.error(f"РЅРµРёР·РІРµСЃС‚РЅС‹Р№ РїСЂРѕРІР°Р№РґРµСЂ '{chosen_id}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: {', '.join(s.id for s in specs)}")
            return 2
        cfg.provider = chosen.id
        cfg.model = _g(args, "model") or cfg.model or chosen.default_model
        key = _g(args, "api_key")
        if key:
            cfg.api_keys[chosen.id] = key
        url = _g(args, "base_url")
        if url:
            cfg.base_url = url
        mode = _g(args, "mode")
        if mode:
            try:
                cfg.permission_mode = Mode(mode).value
            except ValueError:
                ui.error(f"РЅРµРёР·РІРµСЃС‚РЅС‹Р№ СЂРµР¶РёРј '{mode}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: {', '.join(m.value for m in Mode)}")
                return 2
        saved_at = config_mod.save(cfg)
        ui.success(f"РљРѕРЅС„РёРі СЃРѕС…СЂР°РЅС‘РЅ: {saved_at}")
        ui.hint(f"provider: {cfg.provider}  model: {cfg.model}  mode: {cfg.permission_mode}")
        ui.hint("Р”Р°Р»СЊС€Рµ: `modkit chat` РёР»Рё `modkit agent \"СЃРґРµР»Р°Р№ РјРѕРґ СЃ РѕРіРЅРµРЅРЅС‹Рј РјРµС‡РѕРј\"`")
        return 0

    ui.header("metera-modkit вЂ” РЅР°СЃС‚СЂРѕР№РєР°")
    specs = list_providers()
    labels = [f"{s.id:12s}  {s.name}" for s in specs]
    pick = ui.choose("Р’С‹Р±РµСЂРё РїСЂРѕРІР°Р№РґРµСЂР° LLM:", labels, default=max(0, next((i for i, s in enumerate(specs) if s.id == "openai"), 0)))
    chosen = specs[pick]
    cfg.provider = chosen.id

    model = ui.ask(f"РњРѕРґРµР»СЊ (Enter = {chosen.default_model})", default=chosen.default_model)
    cfg.model = model or chosen.default_model

    if chosen.requires_api_key:
        env_name = config_mod.Config._env_for(chosen.id)
        existing = cfg.api_key_for(chosen.id)
        if existing:
            ui.hint(f"РЅР°Р№РґРµРЅ API РєР»СЋС‡ (РёР· {env_name} РёР»Рё config), РѕСЃС‚Р°РІР»СЋ РєР°Рє РµСЃС‚СЊ. Р’РІРµРґРё РЅРѕРІС‹Р№ РёР»Рё Enter С‡С‚РѕР±С‹ РїСЂРѕРїСѓСЃС‚РёС‚СЊ.")
        key = ui.ask(f"API РєР»СЋС‡ РґР»СЏ {chosen.name} (Enter = РѕСЃС‚Р°РІРёС‚СЊ РєР°Рє РµСЃС‚СЊ)", default="")
        if key:
            cfg.api_keys[chosen.id] = key
    else:
        ui.hint(f"{chosen.name} РЅРµ С‚СЂРµР±СѓРµС‚ API РєР»СЋС‡Р°.")

    if chosen.id in ("local", "custom"):
        url = ui.ask(f"Base URL (Enter = {chosen.default_base_url or 'РЅРµ СѓРєР°Р·Р°РЅ'})", default=chosen.default_base_url)
        cfg.base_url = url

    modes = [f"{m.value:10s} вЂ” {describe_mode(m).split('вЂ”', 1)[1].strip()}" for m in Mode]
    cur_idx = next((i for i, m in enumerate(Mode) if m.value == cfg.permission_mode), 0)
    pick_mode = ui.choose("Р РµР¶РёРј СЂР°Р·СЂРµС€РµРЅРёР№:", modes, default=cur_idx)
    cfg.permission_mode = list(Mode)[pick_mode].value

    saved_at = config_mod.save(cfg)
    ui.success(f"РљРѕРЅС„РёРі СЃРѕС…СЂР°РЅС‘РЅ: {saved_at}")
    ui.hint("Р”Р°Р»СЊС€Рµ: `modkit chat` РёР»Рё `modkit agent \"СЃРґРµР»Р°Р№ РјРѕРґ СЃ РѕРіРЅРµРЅРЅС‹Рј РјРµС‡РѕРј\"`")
    return 0


def cmd_providers(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    if _g(args, "json_output"):
        payload = [
            {
                "id": s.id,
                "name": s.name,
                "default_model": s.default_model,
                "default_base_url": s.default_base_url,
                "requires_api_key": s.requires_api_key,
            }
            for s in list_providers()
        ]
        ui.write_json(payload)
        return 0
    ui.header("Р”РѕСЃС‚СѓРїРЅС‹Рµ LLM РїСЂРѕРІР°Р№РґРµСЂС‹:")
    for spec in list_providers():
        marker = ui.color("green", "*") if cfg.provider == spec.id else " "
        ui.hint(f"  {marker} {spec.id:12s}  {spec.name}")
        if spec.default_model:
            ui.hint(f"      default model: {spec.default_model}")
        if spec.default_base_url:
            ui.hint(f"      default URL  : {spec.default_base_url}")
    return 0


def cmd_doctor(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    ui.header("metera-modkit doctor")
    res = resources_dir()
    ui.info(f"resources dir : {res} ({'exists' if res.exists() else 'MISSING'})")
    ui.info(f"config file   : {config_mod.config_path()}")
    ui.info(f"user dir      : {user_config_dir()}")
    mods = resolve_mods_root(cfg.mods_dir or None)
    ui.info(f"mods root     : {mods}")
    ui.info(f"game mods dir : {game_mods_dir()}")

    # Engine source state (clone at <source_root>/<owner>__<repo>/).
    try:
        from modkit.source_manager import default_manager, default_spec
        mgr = default_manager()
        spec = default_spec()
        d = mgr.dir_for(spec)
        if mgr.is_cloned(spec):
            ui.success(f"engine source : {d} (cloned)")
            try:
                ui.info(f"  current SHA : {mgr.current_sha(spec)}")
            except Exception as exc:  # pragma: no cover - best-effort
                ui.info(f"  current SHA : <unknown: {exc}>")
        else:
            ui.warn(f"engine source : {d} (NOT cloned — agent/chat will prompt on first use)")
    except Exception as exc:  # pragma: no cover - best-effort
        ui.warn(f"engine source : <check failed: {exc}>")

    manifest = docs_index.runtime_manifest()
    if manifest:
        keys = sorted(manifest.get("database_files", {}).keys())
        ui.success(f"runtime_manifest.json loaded ({len(keys)} database keys)")
    else:
        ui.warn("runtime_manifest.json missing вЂ” docs/schema tools will be limited")

    sections = docs_index.all_sections()
    if sections:
        ui.success(f"README.md indexed ({len(sections)} sections)")
    else:
        ui.warn("README.md missing вЂ” docs_search/docs_section will be empty")

    if cfg.provider:
        ui.info(f"provider      : {cfg.provider} (model: {cfg.model or '?'})")
        key = cfg.api_key_for(cfg.provider)
        ui.info(f"api key       : {'set' if key else 'NOT set'}")
    else:
        ui.warn("provider РЅРµ РЅР°СЃС‚СЂРѕРµРЅ. Р—Р°РїСѓСЃС‚Рё `modkit init`.")

    return 0


def cmd_list(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    mods_root = resolve_mods_root(cfg.mods_dir or None)
    if not mods_root.exists():
        ui.warn(f"РїР°РїРєР° РјРѕРґРѕРІ РїСѓСЃС‚Р°: {mods_root}")
        return 0
    mods: list[dict] = []
    for child in sorted(mods_root.iterdir()):
        if not child.is_dir():
            continue
        meta_path = child / "mod.json"
        meta: dict = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                meta = {"_error": "invalid mod.json"}
        mods.append(
            {
                "folder": child.name,
                "id": meta.get("id", ""),
                "name": meta.get("name", ""),
                "version": meta.get("version", ""),
                "author": meta.get("author", ""),
                "description": meta.get("description", ""),
                "has_mod_json": meta_path.exists(),
            }
        )

    if _g(args, "json_output"):
        ui.write_json({"mods_root": str(mods_root), "mods": mods})
        return 0

    ui.header(f"РњРѕРґС‹ РІ {mods_root}:")
    if not mods:
        ui.hint("  (РЅРµС‚ РјРѕРґРѕРІ)")
        return 0
    for m in mods:
        head = f"  {m['folder']:30s}  v{m['version'] or '?':<10s} {m['name']}"
        ui.hint(head)
        if args.full and m["description"]:
            ui.hint(f"      {m['description']}")
    return 0


def cmd_new(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    mods_root = resolve_mods_root(cfg.mods_dir or None)
    registry, ctx = _build_runtime_context(cfg, args, include_shell=False)
    ctx.mods_root = mods_root
    mod_id = args.id_flag or args.id
    if not mod_id:
        ui.error("РЅСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ id РјРѕРґР°: `modkit new my_mod` РёР»Рё `modkit new --id my_mod`")
        return 2
    payload = {
        "id": mod_id,
        "name": args.name or mod_id,
        "author": args.author,
        "description": args.description,
    }
    if args.total_conversion:
        payload["total_conversion"] = True
    # We don't need permission prompts for the explicit CLI command, so
    # we temporarily promote the mode to yolo.
    original_mode = ctx.mode
    ctx.mode = Mode.YOLO
    result = registry.run("new_mod", payload, ctx)
    ctx.mode = original_mode
    if not result.ok:
        if _g(args, "json_output"):
            ui.write_json(result.to_dict())
        ui.error(result.error)
        return 1
    mod_path = Path(result.data.get("mod_path"))
    # Apply a quick-create template if requested.
    template_name = (args.template or "empty").lower()
    if template_name not in ("empty", "none", ""):
        from modkit.templates import get_template, write_template

        fn = get_template(template_name)
        if fn is None:
            ui.warn(f"неизвестный шаблон '{template_name}', пропускаю")
        else:
            ctx_template = {
                "id": mod_id,
                "name": args.name or mod_id,
                "author": args.author,
                "description": args.description,
            }
            files = fn(ctx_template)
            write_template(mod_path, files)
            # Re-merge mod.json from CLI overrides (template may set its own
            # values, but CLI flags always win).
            mj = mod_path / "mod.json"
            try:
                mj_data = json.loads(mj.read_text(encoding="utf-8"))
            except Exception:
                mj_data = {}
            mj_data["id"] = mod_id
            if args.name:
                mj_data["name"] = args.name
            if args.author:
                mj_data["author"] = args.author
            if args.description:
                mj_data["description"] = args.description
            if args.total_conversion:
                mj_data["total_conversion"] = True
            mj.write_text(
                json.dumps(mj_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    if _g(args, "json_output"):
        ui.write_json(result.to_dict())
        return 0
    ui.success(f"РјРѕРґ '{mod_id}' СЃРѕР·РґР°РЅ: {mod_path}")
    for f in sorted(result.data.get("files", [])):
        ui.hint(f"  + {f}")
    return 0


def cmd_validate(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    mods_root = resolve_mods_root(cfg.mods_dir or None)
    target = args.mod_id or _g(args, "mod")
    if not target:
        ui.error("СѓРєР°Р¶Рё РјРѕРґ: `modkit validate <id>` РёР»Рё С„Р»Р°Рі `--mod <id>`")
        return 2
    mod_path = mods_root / target
    if not mod_path.exists():
        ui.error(f"РјРѕРґ РЅРµ РЅР°Р№РґРµРЅ: {mod_path}")
        return 2
    report = validate_mod(mod_path)
    if _g(args, "json_output"):
        ui.write_json(report.to_dict())
        return 0 if report.ok else 1
    if report.ok:
        ui.success(f"РјРѕРґ '{target}' РІР°Р»РёРґРµРЅ")
    else:
        ui.error(f"РјРѕРґ '{target}' РЅРµРІР°Р»РёРґРµРЅ")
    for err in report.errors:
        ui.error(f"  {err}")
    for warn in report.warnings:
        ui.warn(f"  {warn}")
    for info in report.info:
        ui.info(f"  {info}")
    return 0 if report.ok else 1


def cmd_docs(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    query = " ".join(args.query)
    results = docs_index.search(query, limit=args.limit)
    if _g(args, "json_output"):
        ui.write_json({"query": query, "results": results})
        return 0
    if not results:
        ui.warn("РЅРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ")
        return 1
    if args.full:
        top = docs_index.find_section(results[0]["id"])
        if top is not None:
            ui.header(f"# {top.title}")
            print(top.body)
        return 0
    ui.header(f"РќР°Р№РґРµРЅРѕ {len(results)} СЃРѕРІРїР°РґРµРЅРёР№ РїРѕ '{query}':")
    for r in results:
        ui.hint(f"  [{r['id']}] (score {r['score']}) {r['title']}")
        if r["snippet"]:
            snippet = r["snippet"].splitlines()[:3]
            for line in snippet:
                ui.hint(f"      {line[:120]}")
    return 0


def cmd_agent(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    task = " ".join(args.task)
    return _run_agent_once(cfg, args, task)


def cmd_run(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    path = Path(args.file).expanduser().resolve()
    if not path.exists():
        ui.error(f"С„Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ: {path}")
        return 2
    task = path.read_text(encoding="utf-8")
    return _run_agent_once(cfg, args, task)


def cmd_chat(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    provider = _build_provider_from_cfg(cfg, args)
    registry, ctx = _build_runtime_context(cfg, args)
    ui.header(
        f"metera-modkit chat ({cfg.provider}/{cfg.model or '?'}, mode={cfg.permission_mode})"
    )
    ui.hint("РєРѕРјР°РЅРґС‹: /exit, /mod <id>, /mode <ask|auto-edit|yolo>, /reset, /help")
    history: list = []
    if args.initial_task:
        joined = " ".join(args.initial_task)
        if joined.strip():
            history = _agent_turn(provider, registry, ctx, cfg, joined, history)

    while True:
        try:
            line = input(ui.color("cyan", "> ")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not line:
            continue
        if line in ("/exit", "/quit", ":q"):
            return 0
        if line == "/help":
            ui.hint("/exit — выйти")
            ui.hint("/mod <id> — переключить активный мод")
            ui.hint("/mode <ask|auto-edit|yolo> — сменить режим разрешений")
            ui.hint("/reset — очистить историю чата")
            ui.hint("/undo — отменить последний запрос")
            ui.hint("/plan <задача> — составить план без изменения файлов")
            ui.hint("/save <имя> — сохранить историю чата")
            ui.hint("/load <имя> — загрузить историю чата")
            ui.hint("/backup [имя] — сделать zip-бэкап текущего мода")
            continue
        if line == "/undo":
            if not history:
                ui.hint("история пуста")
                continue
            idx = len(history) - 1
            while idx >= 0 and history[idx].role != "user":
                idx -= 1
            if idx >= 0:
                history = history[:idx]
                ui.success("последний запрос отменён")
            else:
                history = []
                ui.success("история очищена")
            continue
        if line.startswith("/plan "):
            arg = line[6:].strip()
            plan_prompt = (
                "ПЛАН ДЕЙСТВИЙ. Изучи текущий мод с помощью инструментов чтения (list_files, read_file, docs_search, schema_lookup). "
                "Напиши подробный пошаговый план решения следующей задачи. "
                "ПОКА НЕ ИЗМЕНЯЙ ФАЙЛЫ (не используй write_file, edit_file, delete_file, shell). "
                f"Задача: {arg}"
            )
            ui.hint(f"режим планирования: {arg}")
            history = _agent_turn(provider, registry, ctx, cfg, plan_prompt, history)
            continue
        if line.startswith("/save "):
            arg = line[6:].strip()
            chats_dir = ctx.mods_root / ".chats"
            chats_dir.mkdir(exist_ok=True)
            path = chats_dir / f"{arg}.json"
            try:
                data = [m.to_dict() for m in history]
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                ui.success(f"чат сохранён: {path}")
            except Exception as e:
                ui.error(f"ошибка сохранения: {e}")
            continue
        if line.startswith("/load "):
            arg = line[6:].strip()
            path = ctx.mods_root / ".chats" / f"{arg}.json"
            if not path.exists():
                ui.error(f"файл не найден: {path}")
                continue
            try:
                from modkit.providers.base import Message
                data = json.loads(path.read_text(encoding="utf-8"))
                history = [Message.from_dict(m) for m in data]
                ui.success(f"чат загружен: {path} ({len(history)} сообщений)")
            except Exception as e:
                ui.error(f"ошибка загрузки: {e}")
            continue
        if line.startswith("/backup"):
            arg = line[7:].strip() or "backup"
            if not ctx.mod_root:
                ui.error("сначала выбери мод (/mod <id>)")
                continue
            backups_dir = ctx.mods_root / ".backups"
            backups_dir.mkdir(exist_ok=True)
            import time
            ts = int(time.time())
            dest = backups_dir / f"{ctx.mod_root.name}_{arg}_{ts}.zip"
            try:
                import zipfile
                import os
                with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
                    for root, _, files in os.walk(ctx.mod_root):
                        for f in files:
                            full = Path(root) / f
                            zf.write(full, full.relative_to(ctx.mod_root.parent))
                ui.success(f"бэкап создан: {dest}")
            except Exception as e:
                ui.error(f"ошибка бэкапа: {e}")
            continue

        if line.startswith("/mod "):
            new_mod = line.split(" ", 1)[1].strip()
            candidate = ctx.mods_root / new_mod
            if not candidate.exists():
                ui.error(f"РјРѕРґ '{new_mod}' РЅРµ РЅР°Р№РґРµРЅ РІ {ctx.mods_root}")
                continue
            ctx.mod_root = candidate
            ctx.shell_cwd = candidate
            ui.success(f"Р°РєС‚РёРІРЅС‹Р№ РјРѕРґ: {new_mod}")
            continue
        if line.startswith("/mode "):
            try:
                ctx.mode = Mode.parse(line.split(" ", 1)[1].strip())
                cfg.permission_mode = ctx.mode.value
                ui.success(f"СЂРµР¶РёРј СЂР°Р·СЂРµС€РµРЅРёР№: {ctx.mode.value}")
            except ValueError as exc:
                ui.error(str(exc))
            continue
        if line == "/reset":
            history = []
            ui.success("РёСЃС‚РѕСЂРёСЏ РѕС‡РёС‰РµРЅР°")
            continue
        history = _agent_turn(provider, registry, ctx, cfg, line, history)


# в”Ђв”Ђ agent runner shared by `agent` / `run` / `chat` в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


def _make_event_handler(cfg: config_mod.Config, json_mode: bool) -> Callable[[AgentEvent], None]:
    if json_mode:
        def handler(event: AgentEvent) -> None:
            payload = {"kind": event.kind}
            if event.text:
                payload["text"] = event.text
            if event.tool_call is not None:
                payload["tool"] = event.tool_call.name
                payload["arguments"] = event.tool_call.arguments
            if event.tool_result is not None:
                payload["result"] = event.tool_result.to_dict()
            print(json.dumps(payload, ensure_ascii=False), flush=True)
        return handler

    def handler(event: AgentEvent) -> None:
        record = event_to_record(event)
        if event.kind == "assistant_text" and event.text:
            print(record.body)
        elif event.kind == "tool_call" and event.tool_call is not None:
            ui.hint(f"  в†’ {record.title} {record.body}".rstrip())
        elif event.kind == "tool_result" and event.tool_result is not None:
            status = "ok" if event.tool_result.ok else "fail"
            color = "green" if event.tool_result.ok else "red"
            tool_name = event.tool_call.name if event.tool_call else ""
            ui.hint(f"    {ui.color(color, status)} {tool_name}")
            if record.body:
                ui.hint(f"      {record.body}")
        elif event.kind == "error":
            ui.error(record.body)

    return handler


def _run_agent_once(
    cfg: config_mod.Config,
    args: argparse.Namespace,
    task: str,
) -> int:
    provider = _build_provider_from_cfg(cfg, args)
    registry, ctx = _build_runtime_context(cfg, args)
    handler = _make_event_handler(cfg, _g(args, "json_output", False))
    try:
        run_agent(
            provider=provider,
            registry=registry,
            ctx=ctx,
            user_task=task,
            max_iterations=cfg.max_iterations or 20,
            on_event=handler,
        )
    except ProviderError as exc:
        ui.error(str(exc))
        return 1
    return 0


def _agent_turn(
    provider: Provider,
    registry: ToolRegistry,
    ctx: ToolContext,
    cfg: config_mod.Config,
    task: str,
    history: list,
) -> list:
    handler = _make_event_handler(cfg, False)
    try:
        return run_agent(
            provider=provider,
            registry=registry,
            ctx=ctx,
            user_task=task,
            history=history,
            max_iterations=cfg.max_iterations or 20,
            on_event=handler,
        )
    except ProviderError as exc:
        ui.error(str(exc))
        return history


# в”Ђв”Ђ entry point в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


def cmd_tui(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    """Launch the terminal-UI workbench."""
    cfg = _apply_global_flags(cfg, args)
    
    try:
        sys.stdin.fileno()
        sys.stdout.fileno()
    except Exception:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                "Невозможно запустить TUI: отсутствует консоль.",
                "metera-modkit",
                0x10
            )
        else:
            ui.error("Невозможно запустить TUI: отсутствует консоль.")
        return 1

    try:
        from modkit.tui import launch as launch_tui
    except ImportError as exc:
        ui.error(
            f"для TUI нужен пакет 'textual': {exc}\n"
            f"поставь: py -m pip install textual"
        )
        return 2
    return launch_tui(cfg)


def cmd_gui(cfg: config_mod.Config, args: argparse.Namespace) -> int:
    """Launch the native Qt GUI workbench."""
    cfg = _apply_global_flags(cfg, args)
    try:
        from modkit.gui import launch_gui
    except ImportError as exc:
        ui.error(
            f"для GUI нужен пакет 'PySide6': {exc}\n"
            f"поставь: py -m pip install PySide6"
        )
        return 2
    return launch_gui(cfg)


COMMANDS: dict[str, Callable[[config_mod.Config, argparse.Namespace], int]] = {
    "init": cmd_init,
    "providers": cmd_providers,
    "doctor": cmd_doctor,
    "list": cmd_list,
    "new": cmd_new,
    "validate": cmd_validate,
    "docs": cmd_docs,
    "agent": cmd_agent,
    "chat": cmd_chat,
    "run": cmd_run,
    "tui": cmd_tui,
    "gui": cmd_gui,
}


def main(argv: list[str] | None = None) -> int:
    _force_utf8_io()
    parser = build_parser()
    # No args: prefer the native Qt GUI. Fall back to the TUI if
    # PySide6 is missing. Print help if neither is available.
    if argv is None and len(sys.argv) == 1:
        try:
            cfg = config_mod.load()
        except KeyboardInterrupt:
            return 130
        # Try the GUI first.
        gui_error = ""
        try:
            from modkit.gui import launch_gui
            return launch_gui(cfg)
        except Exception as e:
            import traceback
            gui_error = traceback.format_exc()

        # Then the TUI.
        try:
            from modkit.tui import launch as launch_tui

            try:
                sys.stdin.fileno()
                sys.stdout.fileno()
            except Exception:
                if sys.platform == "win32":
                    import ctypes
                    msg = f"Не удалось запустить GUI и нет консоли для TUI.\n\nТрейсбек ошибки GUI:\n{gui_error}"
                    ctypes.windll.user32.MessageBoxW(0, msg, "metera-modkit", 0x10)
                return 1

            return launch_tui(cfg)
        except ImportError:
            pass
        parser.print_help()
        return 0
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    if args.command == "version":
        print(__version__)
        return 0
    cfg = config_mod.load()
    cfg = _apply_global_flags(cfg, args)
    if not _ensure_source_ready(args):
        return 1
    handler = COMMANDS.get(args.command)
    if handler is None:
        parser.error(f"unknown command '{args.command}'")
        return 2
    try:
        return handler(cfg, args)
    except KeyboardInterrupt:
        ui.warn("прервано пользователем")
        return 130


if __name__ == "__main__":
    sys.exit(main())

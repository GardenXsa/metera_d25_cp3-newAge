"""``preflight_mod`` tool — run the JS ModLoader preflight locally.

The JavaScript ModLoader in ``js/mods/ModLoader.js`` runs two checks
on every mod before activating it:

  * metadata validation (``_validateModMeta``)
  * "declarative data preflight" (``_validateDeclarativeModData``)

This tool runs the same logic in Python (see :mod:`modkit.preflight`),
so the agent can see exactly the same errors the JS layer would
report in the Electron DevConsole, without launching the engine.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from modkit.permissions import Kind
from modkit.preflight import run_preflight
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _format_log(reports: dict[str, dict[str, Any]]) -> str:
    """Render the preflight results in the JS console's message format."""
    lines: list[str] = []
    for mod_id, report in reports.items():
        if report["ok"]:
            continue
        meta_errs = report["meta_errors"]
        data_errs = report["data_errors"]
        if meta_errs:
            msg = f'[ModLoader] Мод "{mod_id}" не прошёл валидацию. Ошибки: ' + "; ".join(meta_errs)
            lines.append(msg)
        if data_errs:
            lines.append(
                f"[ModLoader] Мод {mod_id} отключён: ошибки declarative data preflight ({len(data_errs)})."
            )
            for err in data_errs:
                lines.append(f"  - {err}")
            lines.append(
                f'[ModLoader] [ModGuard] Мод {mod_id} отключён: declarative data preflight failed ({len(data_errs)})'
            )
    if not lines:
        return "All mods passed preflight."
    return "\n".join(lines)


# Russian text fragments (kept as module-level constants so the
# formatter can be unit-tested without the report dict).
_RU_DISABLED = "отключён"
_RU_FAILED_VALIDATION = "не прошёл валидацию"
_RU_DECLARATIVE_PREFLIGHT = "ошибки declarative data preflight"


def _preflight(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mod_id = args.get("mod_id")
    mods_list = args.get("mods")
    ids: list[str] = []
    if mod_id:
        ids.append(str(mod_id).strip())
    if isinstance(mods_list, list):
        for m in mods_list:
            if isinstance(m, str) and m.strip():
                ids.append(m.strip())
    if not ids:
        return ToolResult(
            ok=False,
            error="pass 'mod_id' (string) or 'mods' (list of strings).",
        )

    mods_root = Path(args.get("mods_dir")).expanduser() if args.get("mods_dir") else ctx.mods_root
    reports = run_preflight(mods_root, ids)
    log = _format_log(reports)

    total_errors = sum(
        len(r["meta_errors"]) + len(r["data_errors"]) for r in reports.values()
    )
    disabled = [r["mod_id"] for r in reports.values() if r["disabled"]]

    return ToolResult(
        ok=total_errors == 0,
        content=log,
        data={
            "mods_root": str(mods_root),
            "reports": reports,
            "total_errors": total_errors,
            "disabled_mods": disabled,
        },
        error=(
            f"{len(disabled)} mod(s) would be disabled by preflight: {disabled}"
            if disabled else ""
        ),
    )


def build_preflight_mod_tool() -> Tool:
    return Tool(
        name="preflight_mod",
        description=(
            "Run the same preflight the JS ModLoader runs on every mod, but in "
            "Python — no engine, no Node.js, no Electron. Catches the errors "
            "you see in the DevConsole: missing required stats, non-numeric "
            "stat values, missing items referenced from tag_defaults, eras "
            "without a default_location_file, etc. Use this BEFORE launching "
            "the game to see which mods will be auto-disabled and why. Pass "
            "either mod_id (single) or mods (list)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "mod_id": {
                    "type": "string",
                    "description": "Run preflight on a single mod (folder name under mods root).",
                },
                "mods": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Run preflight on a list of mod IDs.",
                },
                "mods_dir": {
                    "type": "string",
                    "description": "Override the mods root. Default: the configured mods root.",
                },
            },
        },
        kind=Kind.READ,
        handler=_preflight,
    )


__all__ = ["build_preflight_mod_tool"]

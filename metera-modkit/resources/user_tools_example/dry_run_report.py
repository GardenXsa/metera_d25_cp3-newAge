"""Example edit-style user tool with a dry_run contract.

Copy this file into your user tools folder and restart ModKit. The
tool does not edit files; it demonstrates the shape a serious custom
tool should expose when it *would* mutate something:

* read useful context from ``ctx``;
* support ``dry_run``;
* return the planned target and a human-readable summary.
"""

from modkit.user_tools import tool


@tool(kind="edit")
def dry_run_report(target_path: str, dry_run: bool = True, ctx=None) -> dict:
    """Report where a custom edit tool would write, without writing."""
    mod_root = str(getattr(ctx, "mod_root", "") or "")
    mods_root = str(getattr(ctx, "mods_root", "") or "")
    return {
        "target_path": target_path,
        "dry_run": dry_run,
        "mod_root": mod_root,
        "mods_root": mods_root,
        "summary": (
            "This example intentionally does not write. Real edit tools "
            "should return a preview/diff when dry_run=true."
        ),
    }

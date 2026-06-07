"""Allow `python -m modkit` invocation."""

import sys


def _ensure_streams() -> None:
    """When launched as a GUI-subsystem .exe (console=False) on Windows,
    ``sys.stdout``/``sys.stderr`` may be ``None``. Replace them with
    harmless dummy streams so the rest of the codebase can call ``print()``,
    ``sys.stdout.isatty()``, ``json.dump(..., sys.stdout)`` etc. without
    crashing. Any real output is still routed to the parent console when
    the .exe is launched from cmd/PowerShell."""
    if getattr(sys, "stdout", None) is None or getattr(sys, "stderr", None) is None or getattr(sys, "stdin", None) is None:
        import io

        class _Dummy(io.TextIOBase):
            def write(self, *_args, **_kwargs):
                return 0

            def flush(self):
                return None

            def isatty(self):
                return False
                
            def read(self, *_args, **_kwargs):
                return ""
                
            def readline(self, *_args, **_kwargs):
                return ""

        if getattr(sys, "stdout", None) is None:
            sys.stdout = _Dummy()
        if getattr(sys, "stderr", None) is None:
            sys.stderr = _Dummy()
        if getattr(sys, "stdin", None) is None:
            sys.stdin = _Dummy()


_ensure_streams()
from modkit.cli import main  # noqa: E402 - import after stream fixup

if __name__ == "__main__":
    raise SystemExit(main())

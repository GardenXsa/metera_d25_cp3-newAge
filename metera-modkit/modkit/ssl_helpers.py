"""Shared SSL helpers.

Centralised here so :mod:`modkit.providers.http` (LLM API calls) and
:mod:`modkit.source_manager` (tarball fallback) build the exact same
SSL context. The two callers have very different error budgets but
share the same trust-store headache: PyInstaller-bundled Pythons see
an empty system cert store, so a stock ``ssl.create_default_context()``
fails ``CERTIFICATE_VERIFY_FAILED`` on ``codeload.github.com`` and
the LLM provider hosts alike.

Resolution order
----------------

1. ``resources/cacert.pem`` shipped with the modkit — always present
   inside ``modkit.exe`` (PyInstaller globs the whole ``resources/``
   folder via ``build.spec``). The Mozilla CA bundle includes the
   DigiCert chain for ``*.github.com`` and the roots used by the LLM
   providers.
2. ``certifi.where()`` if the host Python has it (the project depends
   on ``requests``, which depends on ``certifi``).
3. ``ssl.create_default_context()`` — works on a normal CPython
   install; the bundled bundle above is a safety net for frozen /
   stripped-down Pythons.
"""

from __future__ import annotations

import ssl
from pathlib import Path
from typing import Optional


_BUNDLED_CA_BUNDLE = "cacert.pem"


def _bundled_ca_path() -> Optional[Path]:
    """Path to the bundled ``cacert.pem``, or ``None`` if not found."""
    try:
        from modkit.paths import resources_dir
        ca = resources_dir() / _BUNDLED_CA_BUNDLE
        if ca.is_file():
            return ca
    except Exception:
        pass
    return None


def ssl_context() -> ssl.SSLContext:
    """Build an SSL context that trusts the public CA chain.

    See module docstring for the resolution order. The function never
    raises — it falls all the way down to ``ssl.create_default_context()``
    if the bundled bundle and ``certifi`` are both unavailable.
    """
    ca = _bundled_ca_path()
    if ca is not None:
        try:
            return ssl.create_default_context(cafile=str(ca))
        except Exception:
            pass
    try:
        import certifi  # type: ignore[import-not-found]
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


# Back-compat alias for code that still references the old helper name.
_ssl_context = ssl_context

"""JSON / JS syntax highlighter for QPlainTextEdit.

Lightweight implementation that recognises strings, numbers, booleans
and the most common punctuation. No external dependencies.
"""

from __future__ import annotations

from PySide6.QtCore import QRegularExpression
from PySide6.QtGui import QColor, QSyntaxHighlighter, QTextCharFormat, QFont


class JsonHighlighter(QSyntaxHighlighter):
    """Minimal JSON syntax highlighter.

    Also does a decent job on JavaScript thanks to the shared
    grammar tokens (string, number, comment for JS).
    """

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._rules: list[tuple[QRegularExpression, QTextCharFormat]] = []

        # Strings
        string_format = QTextCharFormat()
        string_format.setForeground(QColor("#ce9178"))
        self._rules.append((QRegularExpression(r'"[^"\\]*(\\.[^"\\]*)*"'), string_format))

        # Numbers
        number_format = QTextCharFormat()
        number_format.setForeground(QColor("#b5cea8"))
        self._rules.append((QRegularExpression(r"\b-?\d+(\.\d+)?([eE][+-]?\d+)?\b"), number_format))

        # Booleans / null
        keyword_format = QTextCharFormat()
        keyword_format.setForeground(QColor("#569cd6"))
        keyword_format.setFontWeight(QFont.Weight.Bold)
        for kw in ("true", "false", "null", "True", "False", "None"):
            self._rules.append(
                (QRegularExpression(rf"\b{kw}\b"), QTextCharFormat(keyword_format))
            )

        # Keys (text before colon)
        key_format = QTextCharFormat()
        key_format.setForeground(QColor("#9cdcfe"))
        self._rules.append((QRegularExpression(r'"[^"\\]*(\\.|[^"\\])*"\s*(?=:)'), key_format))

        # Punctuation
        punct_format = QTextCharFormat()
        punct_format.setForeground(QColor("#d4d4d4"))
        self._rules.append((QRegularExpression(r"[\{\}\[\],:]"), punct_format))

    def highlightBlock(self, text: str) -> None:  # type: ignore[override]
        for pattern, fmt in self._rules:
            it = pattern.globalMatch(text)
            while it.hasNext():
                m = it.next()
                self.setFormat(m.capturedStart(), m.capturedLength(), fmt)

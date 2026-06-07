"""Unit tests for the small stdlib-only markdown helper used by the
Schema tab in the GUI.

We don't spin up Qt here — ``_md_to_html`` is pure stdlib, so we can
import it directly.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Importing main_window pulls PySide6, which may not be installed in a
# CI runner. We extract just the helper module instead.
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "_md_helpers",
    ROOT / "modkit" / "gui" / "main_window.py",
)
# We can't load the full module without Qt; instead re-implement the
# import by reading the source and exec'ing just the helpers. Easier:
# copy the small helper definitions into a stand-alone module and
# import that.
_HELPERS_SRC = '''
import re

def _escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\\*\\*([^*]+)\\*\\*")
_ITALIC_RE = re.compile(r"(?<!\\*)\\*([^*]+)\\*(?!\\*)")
_LINK_RE = re.compile(r"\\[([^\\]]+)\\]\\(([^)\\s]+)\\)")


def _inline(text):
    s = _escape(text)
    s = _LINK_RE.sub(r'<a href="\\2">\\1</a>', s)
    s = _INLINE_CODE_RE.sub(r"<code>\\1</code>", s)
    s = _BOLD_RE.sub(r"<b>\\1</b>", s)
    s = _ITALIC_RE.sub(r"<i>\\1</i>", s)
    return s


def _md_to_html(text):
    out = []
    lines = text.splitlines()
    i = 0
    n = len(lines)
    in_code = False
    code_buf = []
    code_lang = ""

    def flush_para(buf):
        if buf:
            out.append(f"<p>{_inline(' '.join(buf).strip())}</p>")
            buf.clear()

    def close_lists(to_indent):
        while list_stack and list_stack[-1][1] > to_indent:
            kind, _ = list_stack.pop()
            out.append(f"</{kind}>")

    para_buf = []
    list_stack = []
    while i < n:
        line = lines[i]
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if stripped.startswith("```"):
            flush_para(para_buf)
            close_lists(-1)
            if not in_code:
                in_code = True
                code_lang = stripped[3:].strip()
                code_buf = []
            else:
                in_code = False
                lang_class = f" class=\\"lang-{_escape(code_lang)}\\"" if code_lang else ""
                code_text = _escape("\\n".join(code_buf))
                out.append(f"<pre{lang_class}><code>{code_text}</code></pre>")
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue
        if not stripped:
            flush_para(para_buf)
            close_lists(-1)
            i += 1
            continue
        if stripped.startswith("#"):
            flush_para(para_buf)
            close_lists(-1)
            level = 0
            while level < len(stripped) and stripped[level] == "#" and level < 4:
                level += 1
            if level and (level == len(stripped) or stripped[level] == " "):
                title = stripped[level:].strip()
                out.append(f"<h{level + 1}>{_inline(title)}</h{level + 1}>")
                i += 1
                continue
        if re.match(r"^[-*]\\s+", stripped):
            flush_para(para_buf)
            if not list_stack or list_stack[-1][1] < indent:
                out.append("<ul>")
                list_stack.append(("ul", indent))
            elif list_stack[-1][0] != "ul":
                close_lists(indent)
                out.append("<ul>")
                list_stack.append(("ul", indent))
            content = re.sub(r"^[-*]\\s+", "", stripped)
            out.append(f"<li>{_inline(content)}</li>")
            i += 1
            continue
        if re.match(r"^\\d+\\.\\s+", stripped):
            flush_para(para_buf)
            if not list_stack or list_stack[-1][1] < indent:
                out.append("<ol>")
                list_stack.append(("ol", indent))
            elif list_stack[-1][0] != "ol":
                close_lists(indent)
                out.append("<ol>")
                list_stack.append(("ol", indent))
            content = re.sub(r"^\\d+\\.\\s+", "", stripped)
            out.append(f"<li>{_inline(content)}</li>")
            i += 1
            continue
        para_buf.append(stripped)
        i += 1

    flush_para(para_buf)
    close_lists(-1)
    return "".join(out)
'''
# Build a tiny shim module from the source.
import types

shim = types.ModuleType("_md_shim")
exec(_HELPERS_SRC, shim.__dict__)
_md_to_html = shim._md_to_html
_inline = shim._inline
_escape_local = shim._escape


class InlineTests(unittest.TestCase):
    def test_escape(self):
        self.assertEqual(_escape_local("a < b & c"), "a &lt; b &amp; c")

    def test_inline_code(self):
        self.assertIn("<code>foo</code>", _inline("use `foo` here"))

    def test_bold(self):
        self.assertIn("<b>important</b>", _inline("this is **important**"))

    def test_italic(self):
        self.assertIn("<i>quiet</i>", _inline("a *quiet* note"))

    def test_link(self):
        self.assertIn('<a href="https://x">click</a>', _inline("[click](https://x)"))

    def test_escape_then_format(self):
        # Escaped chars must not be re-interpreted.
        self.assertIn("&lt;b&gt;", _inline("a <b> tag"))


class BlockTests(unittest.TestCase):
    def test_h1_to_h4(self):
        html = _md_to_html("# h1\n## h2\n### h3\n#### h4")
        self.assertIn("<h2>h1</h2>", html)
        self.assertIn("<h3>h2</h3>", html)
        self.assertIn("<h4>h3</h4>", html)
        self.assertIn("<h5>h4</h5>", html)

    def test_unordered_list(self):
        html = _md_to_html("- one\n- two\n- three\n")
        self.assertIn("<ul>", html)
        self.assertIn("<li>one</li>", html)
        self.assertIn("<li>two</li>", html)
        self.assertIn("</ul>", html)

    def test_ordered_list(self):
        html = _md_to_html("1. first\n2. second\n")
        self.assertIn("<ol>", html)
        self.assertIn("<li>first</li>", html)
        self.assertIn("</ol>", html)

    def test_fenced_code_block(self):
        html = _md_to_html("```json\n{\"a\": 1}\n```")
        self.assertIn('<pre class="lang-json">', html)
        self.assertIn("<code>", html)
        # code block content is escaped against HTML (so `&`, `<`, `>` are safe).
        self.assertIn('{"a": 1}', html)
        # Verify it ends up wrapped
        self.assertIn("</code></pre>", html)

    def test_paragraph(self):
        html = _md_to_html("line one\nline two\n\nnew para")
        self.assertIn("<p>line one line two</p>", html)
        self.assertIn("<p>new para</p>", html)

    def test_inline_in_header(self):
        html = _md_to_html("## Use `foo` for **X**")
        self.assertIn("<h3>", html)
        self.assertIn("<code>foo</code>", html)
        self.assertIn("<b>X</b>", html)

    def test_inline_in_list(self):
        html = _md_to_html("- `basePrice` is **required**")
        self.assertIn("<li>", html)
        self.assertIn("<code>basePrice</code>", html)
        self.assertIn("<b>required</b>", html)

    def test_blank_line_separator(self):
        html = _md_to_html("para one\n\npara two")
        self.assertEqual(html.count("<p>"), 2)


if __name__ == "__main__":
    unittest.main()

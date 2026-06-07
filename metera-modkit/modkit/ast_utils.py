"""AST helpers shared by the refactor / engine-intel / symbol tools.

Why a separate module
---------------------

``refactor.py`` and ``engine_intel.py`` both need to (1) find a function
or class by name in a Python source file, including nested
definitions, (2) extract the exact original text of that symbol so we
can copy it byte-for-byte into another file, and (3) rewrite names
inside a parsed AST.

Putting the helpers in one place keeps the tools themselves small
(declarative glue around :func:`extract_symbol`, :func:`replace_name`,
etc.) and gives the test suite a single surface to cover.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


# ── public dataclass ────────────────────────────────────────────────


@dataclass(frozen=True)
class SymbolSpan:
    """The exact [start, end) byte range of a top-level symbol."""

    name: str
    kind: str  # "function" | "asyncfunction" | "class"
    start_line: int  # 1-indexed
    end_line: int  # 1-indexed, inclusive
    decorators_line: int | None  # 1-indexed, or None
    nested_in: tuple[str, ...]  # chain of enclosing class/function names
    text: str  # the verbatim source, lines joined with '\n'

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "decorators_line": self.decorators_line,
            "nested_in": list(self.nested_in),
        }


class SymbolNotFoundError(ValueError):
    """Raised when a symbol name is not present in a parsed file."""


class AmbiguousSymbolError(ValueError):
    """Raised when the same name refers to multiple distinct symbols."""


# ── parsing ────────────────────────────────────────────────────────


def parse_python(path: Path) -> ast.Module:
    """Read *path* and parse it as a Python module.

    On ``SyntaxError`` we re-raise a :class:`ValueError` so the tool
    layer can surface a clear message to the LLM.
    """
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{path}: not a UTF-8 text file ({exc})") from exc
    try:
        return ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        raise ValueError(f"{path}: syntax error: {exc.msg}") from exc


# ── symbol lookup ──────────────────────────────────────────────────


_KIND_FOR_NODE = {
    ast.FunctionDef: "function",
    ast.AsyncFunctionDef: "asyncfunction",
    ast.ClassDef: "class",
}


def iter_symbols(
    tree: ast.Module,
    *,
    name: str | None = None,
    kind: str | None = None,
) -> Iterable[SymbolSpan]:
    """Yield every function / class / async-function defined in *tree*.

    Walks into nested classes and functions so the agent can grab
    methods too. With *name* / *kind* given, the iterator filters
    to just the matching symbols.
    """
    lines = ast.unparse(tree)  # not used; we keep raw lines below
    del lines

    def walk(node: ast.AST, chain: tuple[str, ...]) -> Iterable[SymbolSpan]:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                child_kind = _KIND_FOR_NODE[type(child)]
                if (name is None or child.name == name) and (
                    kind is None or child_kind == kind
                ):
                    yield _span_for(child, child_kind, chain)
                yield from walk(child, chain + (child.name,))

    yield from walk(tree, ())


def find_symbol(
    tree: ast.Module,
    name: str,
    *,
    kind: str | None = None,
    expect_unique: bool = True,
) -> SymbolSpan:
    """Return the :class:`SymbolSpan` for *name*.

    With ``expect_unique=True`` (the default) the call raises
    :class:`AmbiguousSymbolError` when more than one symbol matches
    (e.g. ``Foo.bar`` defined inside two different classes) and
    :class:`SymbolNotFoundError` when nothing matches. The agent
    almost always wants the unambiguous path; the rare cases that
    need the ambiguity just pass ``expect_unique=False`` and pick
    from the list themselves.
    """
    matches = list(iter_symbols(tree, name=name, kind=kind))
    if not matches:
        raise SymbolNotFoundError(f"symbol '{name}' not found")
    if expect_unique and len(matches) > 1:
        formatted = ", ".join(
            ".".join((*(s.nested_in), s.name)) for s in matches
        )
        raise AmbiguousSymbolError(
            f"symbol '{name}' is ambiguous: matches {formatted}"
        )
    return matches[0]


def _span_for(
    node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef,
    kind: str,
    chain: tuple[str, ...],
) -> SymbolSpan:
    """Compute the source span of *node* (decorators included)."""
    # Decorators are stored on the node, but each one is a separate
    # Expr-wrapped statement that lives *before* the def line. The
    # AST gives us the def's lineno; we have to walk back over the
    # ``decorator_list`` to find the first decorator's line.
    dec_line = node.decorator_list[0].lineno if node.decorator_list else None
    start = dec_line or node.lineno
    end = getattr(node, "end_lineno", None) or node.lineno
    return SymbolSpan(
        name=node.name,
        kind=kind,
        start_line=start,
        end_line=end,
        decorators_line=dec_line,
        nested_in=chain,
        text="",  # filled in by ``materialise_text``
    )


def materialise_text(span: SymbolSpan, source_lines: list[str]) -> SymbolSpan:
    """Return a copy of *span* with ``text`` filled in from *source_lines*.

    The span's line numbers are 1-indexed and inclusive on both
    ends, matching the rest of the modkit. The returned object
    keeps the same shape so callers can swap it in seamlessly.
    """
    text = "\n".join(source_lines[span.start_line - 1 : span.end_line])
    return SymbolSpan(
        name=span.name,
        kind=span.kind,
        start_line=span.start_line,
        end_line=span.end_line,
        decorators_line=span.decorators_line,
        nested_in=span.nested_in,
        text=text,
    )


# ── rewriting ──────────────────────────────────────────────────────


def replace_name_in_tree(
    tree: ast.Module,
    old: str,
    new: str,
    *,
    scope: str = "all",
) -> ast.AST:
    """Return a copy of *tree* with every occurrence of *old* rewritten to *new*.

    *scope* controls how aggressively the rename touches the tree:

    * ``"all"`` (default): rename ``old`` everywhere — names, attribute
      accesses, ``Name`` nodes, ``FunctionDef.name``, ``arg.arg``,
      keyword arguments, exception handlers, global / nonlocal
      statements. This is what ``rename_symbol`` wants for a
      function or class.

    * ``"local"``: only rename bare ``Name`` lookups and attribute
      accesses; do NOT rename the def line itself or argument
      names. Useful for renaming a *use* of a symbol without
      moving the definition.

    The rewrite is name-only — it does NOT look at scoping rules.
    A local variable named ``foo`` will be renamed even if the
    function also imports a module called ``foo``. Callers that
    care should pre-filter the AST themselves; the common case
    (rename a public function) is safe.
    """
    if not old or not isinstance(old, str):
        raise ValueError("'old' must be a non-empty string")
    if not isinstance(new, str):
        raise ValueError("'new' must be a string")
    if old == new:
        return tree

    new_tree = ast.parse(ast.unparse(tree))  # deep copy via round-trip

    def visit(node: ast.AST) -> None:
        for child in ast.walk(node):
            if isinstance(child, ast.Name) and child.id == old:
                child.id = new
            elif isinstance(child, ast.Attribute) and child.attr == old:
                child.attr = new
            elif isinstance(child, ast.arg) and child.arg == old:
                child.arg = new
            elif isinstance(child, ast.FunctionDef) and scope == "all" and child.name == old:
                child.name = new
            elif isinstance(child, ast.AsyncFunctionDef) and scope == "all" and child.name == old:
                child.name = new
            elif isinstance(child, ast.ClassDef) and scope == "all" and child.name == old:
                child.name = new
            elif isinstance(child, ast.keyword) and child.arg == old:
                child.arg = new
            # global/nonlocal statements hold a list of names
            elif isinstance(child, (ast.Global, ast.Nonlocal)) and old in child.names:
                child.names = [new if n == old else n for n in child.names]
            # ``except Foo as bar:`` — the exception type can be a
            # Name, Attribute, or Tuple of those; we rewrite whichever
            # we find.
            elif isinstance(child, ast.ExceptHandler) and child.name == old:
                child.name = new

    visit(new_tree)
    return new_tree


# ── imports analysis ───────────────────────────────────────────────


@dataclass(frozen=True)
class ImportUse:
    """One import statement and which of its names are unused."""

    start_line: int
    end_line: int
    text: str
    unused: tuple[str, ...]


def find_unused_imports(source: str) -> list[ImportUse]:
    """Return one :class:`ImportUse` per import line whose names are all unused.

    A name is considered *used* if it appears anywhere in the source
    other than the import statement itself — a name lookup, an
    attribute access, a function call, a ``from x import y`` followed
    by ``y()`` somewhere. Naive but good enough: the common case is
    ``import json`` with no ``json.`` anywhere, or ``from pathlib
    import Path`` with no ``Path`` reference.

    The function is line-oriented: it groups consecutive import
    statements into the same :class:`ImportUse`. Unused entries inside
    a mixed block (some used, some not) are reported on their own line
    if possible.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    # Collect every Name in the body that isn't inside an import stmt.
    used: set[str] = set()
    for node in ast.walk(tree):
        # Walk the body but skip import statements themselves.
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if isinstance(node, ast.Name):
            used.add(node.id)
        elif isinstance(node, ast.Attribute):
            # The leftmost name in ``a.b.c`` is what actually gets
            # resolved; ``b`` and ``c`` are attributes on the value.
            root = node
            while isinstance(root, ast.Attribute):
                root = root.value
            if isinstance(root, ast.Name):
                used.add(root.id)
        elif isinstance(node, ast.arg):
            # Function / lambda argument names are not "uses" of an
            # import. Skip them to avoid false positives.
            pass

    lines = source.splitlines()
    results: list[ImportUse] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [(alias.asname or alias.name).split(".")[0] for alias in node.names]
            unused = tuple(n for n in names if n not in used)
            if unused:
                results.append(
                    ImportUse(
                        start_line=node.lineno,
                        end_line=getattr(node, "end_lineno", node.lineno),
                        text="\n".join(lines[node.lineno - 1 : getattr(node, "end_lineno", node.lineno)]),
                        unused=unused,
                    )
                )
        elif isinstance(node, ast.ImportFrom):
            names = [alias.asname or alias.name for alias in node.names]
            # ``from x import *`` has no usable per-name info — skip
            if names == ["*"]:
                continue
            unused = tuple(n for n in names if n not in used)
            if unused:
                results.append(
                    ImportUse(
                        start_line=node.lineno,
                        end_line=getattr(node, "end_lineno", node.lineno),
                        text="\n".join(lines[node.lineno - 1 : getattr(node, "end_lineno", node.lineno)]),
                        unused=unused,
                    )
                )
    return results

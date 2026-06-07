"""Tests for the user-defined Skills feature.

Skills are pure markdown — a folder with a ``SKILL.md`` file containing
YAML frontmatter (name + description) and a markdown body. The agent
discovers them from disk, advertises them in the system prompt, and
loads the body on demand via the ``read_skill`` tool.
"""

from __future__ import annotations

import shutil
import tempfile
import textwrap
import unittest
from pathlib import Path

from modkit.skills import (
    SKILL_NAME_RE,
    Skill,
    SkillParseError,
    build_read_skill_tool,
    discover_user_skills,
    format_skills_for_prompt,
    load_skill_file,
    parse_skill_md,
)
from modkit.tools.registry import ToolContext, ToolResult


# ── parser tests ──────────────────────────────────────────────────────


class ParseSkillMdTests(unittest.TestCase):
    def test_minimal_frontmatter(self):
        text = textwrap.dedent(
            """\
            ---
            name: strict_lore
            description: Lock the agent to canonical Meterea lore.
            ---

            # Body
            Hello world.
            """
        )
        result = parse_skill_md(text)
        self.assertEqual(result.name, "strict_lore")
        self.assertEqual(result.description, "Lock the agent to canonical Meterea lore.")
        self.assertIn("Hello world.", result.body)
        self.assertIn("# Body", result.body)

    def test_missing_frontmatter_delimiter(self):
        with self.assertRaises(SkillParseError) as ctx:
            parse_skill_md("# no frontmatter\n")
        self.assertIn("frontmatter", str(ctx.exception).lower())

    def test_unterminated_frontmatter(self):
        with self.assertRaises(SkillParseError) as ctx:
            parse_skill_md("---\nname: x\n")
        self.assertIn("unterminated", str(ctx.exception).lower())

    def test_missing_name(self):
        with self.assertRaises(SkillParseError) as ctx:
            parse_skill_md("---\ndescription: foo\n---\nbody\n")
        self.assertIn("name", str(ctx.exception))

    def test_missing_description(self):
        with self.assertRaises(SkillParseError) as ctx:
            parse_skill_md("---\nname: foo\n---\nbody\n")
        self.assertIn("description", str(ctx.exception))

    def test_invalid_name_with_space(self):
        with self.assertRaises(SkillParseError):
            parse_skill_md("---\nname: 'has space'\ndescription: x\n---\nbody\n")

    def test_invalid_name_uppercase(self):
        with self.assertRaises(SkillParseError):
            parse_skill_md("---\nname: StrictLore\ndescription: x\n---\nbody\n")

    def test_invalid_name_starts_with_digit(self):
        with self.assertRaises(SkillParseError):
            parse_skill_md("---\nname: 1skill\ndescription: x\n---\nbody\n")

    def test_literal_block_description(self):
        text = textwrap.dedent(
            """\
            ---
            name: foo
            description: |
              This description
              spans three lines.
            ---

            body
            """
        )
        result = parse_skill_md(text)
        self.assertIn("spans three lines", result.description)
        self.assertNotIn("|", result.description)

    def test_folded_block_description(self):
        text = textwrap.dedent(
            """\
            ---
            name: foo
            description: >
              this is
              folded into
              one line
            ---

            body
            """
        )
        result = parse_skill_md(text)
        self.assertIn("one line", result.description)
        # folded joins with spaces
        self.assertNotIn("\n", result.description)

    def test_quoted_value_strips_quotes(self):
        text = '---\nname: foo\ndescription: "Quoted value."\n---\nbody\n'
        result = parse_skill_md(text)
        self.assertEqual(result.description, "Quoted value.")

    def test_extra_metadata_preserved(self):
        text = "---\nname: foo\ndescription: x\nversion: 1.2\nauthor: bob\n---\nbody\n"
        result = parse_skill_md(text)
        self.assertEqual(result.metadata.get("version"), "1.2")
        self.assertEqual(result.metadata.get("author"), "bob")

    def test_comments_and_blank_lines_ignored(self):
        text = textwrap.dedent(
            """\
            ---
            # this is a comment
            name: foo

            description: hi
            ---

            body
            """
        )
        result = parse_skill_md(text)
        self.assertEqual(result.name, "foo")
        self.assertEqual(result.description, "hi")

    def test_skill_name_regex(self):
        valid = ["foo", "foo_bar", "foo-bar", "a1b2", "a" * 64]
        for v in valid:
            self.assertTrue(SKILL_NAME_RE.match(v), f"expected valid: {v}")
        invalid = ["", "Foo", "1foo", "foo bar", "a" * 65, "foo.bar", "foo/bar"]
        for v in invalid:
            self.assertFalse(SKILL_NAME_RE.match(v), f"expected invalid: {v!r}")


# ── discovery tests ──────────────────────────────────────────────────


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="skills_test_"))

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write(self, rel_path: str, content: str) -> Path:
        path = self._tmp / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_empty_root_returns_empty(self):
        self.assertEqual(discover_user_skills(self._tmp), [])

    def test_finds_single_skill(self):
        self._write(
            "strict_lore/SKILL.md",
            "---\nname: strict_lore\ndescription: Lock to canon.\n---\nBody here.\n",
        )
        skills = discover_user_skills(self._tmp)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].name, "strict_lore")
        self.assertEqual(skills[0].description, "Lock to canon.")
        self.assertIn("Body here.", skills[0].body)

    def test_finds_multiple_skills_sorted(self):
        for n in ("zebra", "alpha", "middle"):
            self._write(
                f"{n}/SKILL.md",
                f"---\nname: {n}\ndescription: d\n---\nbody of {n}\n",
            )
        skills = discover_user_skills(self._tmp)
        self.assertEqual([s.name for s in skills], ["alpha", "middle", "zebra"])

    def test_skips_broken_file(self):
        self._write(
            "broken/SKILL.md",
            "no frontmatter here\n",
        )
        self._write(
            "good/SKILL.md",
            "---\nname: good\ndescription: d\n---\nbody\n",
        )
        skills = discover_user_skills(self._tmp)
        self.assertEqual([s.name for s in skills], ["good"])

    def test_skips_duplicate_names(self):
        for n in ("dup", "dup"):
            self._write(
                f"{n}/SKILL.md",
                f"---\nname: dup\ndescription: d\n---\nbody {n}\n",
            )
        skills = discover_user_skills(self._tmp)
        self.assertEqual(len(skills), 1)

    def test_folder_name_mismatch_is_fine(self):
        # Folder name doesn't have to match the frontmatter name; the
        # frontmatter is the source of truth.
        self._write(
            "different_folder/SKILL.md",
            "---\nname: real_name\ndescription: d\n---\nbody\n",
        )
        skills = discover_user_skills(self._tmp)
        self.assertEqual([s.name for s in skills], ["real_name"])

    def test_missing_root_returns_empty(self):
        ghost = self._tmp / "does_not_exist"
        self.assertEqual(discover_user_skills(ghost), [])

    def test_load_skill_file(self):
        p = self._write(
            "x/SKILL.md",
            "---\nname: x\ndescription: d\n---\nhello\n",
        )
        skill = load_skill_file(p)
        self.assertIsInstance(skill, Skill)
        self.assertEqual(skill.name, "x")
        self.assertEqual(skill.source, p)


# ── prompt formatter tests ───────────────────────────────────────────


class PromptFormatTests(unittest.TestCase):
    def test_empty_returns_empty(self):
        self.assertEqual(format_skills_for_prompt([]), "")

    def test_single_skill_appears(self):
        skill = Skill(
            name="strict_lore",
            description="Lock to canon.",
            body="body",
            source=Path("/tmp/x"),
        )
        text = format_skills_for_prompt([skill])
        self.assertIn("AVAILABLE SKILLS", text)
        self.assertIn("**strict_lore**", text)
        self.assertIn("Lock to canon.", text)
        self.assertIn("read_skill", text)

    def test_multiple_skills_all_listed(self):
        skills = [
            Skill(name="a", description="A desc.", body="", source=Path("/x")),
            Skill(name="b", description="B desc.", body="", source=Path("/x")),
        ]
        text = format_skills_for_prompt(skills)
        self.assertIn("**a**", text)
        self.assertIn("**b**", text)
        self.assertIn("A desc.", text)
        self.assertIn("B desc.", text)


# ── read_skill tool tests ────────────────────────────────────────────


class ReadSkillToolTests(unittest.TestCase):
    def _ctx(self) -> ToolContext:
        return ToolContext(mods_root=Path("/tmp/mods"))

    def test_reads_existing_skill(self):
        skill = Skill(
            name="strict_lore",
            description="d",
            body="the body",
            source=Path("/tmp/x/SKILL.md"),
        )
        tool = build_read_skill_tool([skill])
        result = tool.handler({"name": "strict_lore"}, self._ctx())
        self.assertIsInstance(result, ToolResult)
        self.assertTrue(result.ok)
        self.assertEqual(result.content, "the body")
        self.assertEqual(result.data["name"], "strict_lore")

    def test_unknown_skill_lists_available(self):
        skill = Skill(name="foo", description="d", body="", source=Path("/x"))
        tool = build_read_skill_tool([skill])
        result = tool.handler({"name": "missing"}, self._ctx())
        self.assertFalse(result.ok)
        self.assertIn("unknown skill", result.error.lower())
        self.assertIn("foo", result.error)

    def test_missing_name_argument(self):
        tool = build_read_skill_tool([])
        result = tool.handler({}, self._ctx())
        self.assertFalse(result.ok)
        self.assertIn("name", result.error.lower())

    def test_empty_name_argument(self):
        tool = build_read_skill_tool([])
        result = tool.handler({"name": "  "}, self._ctx())
        self.assertFalse(result.ok)

    def test_tool_metadata(self):
        tool = build_read_skill_tool([])
        self.assertEqual(tool.name, "read_skill")
        self.assertIn("skill", tool.description.lower())
        self.assertIn("read", tool.description.lower())
        self.assertIn("name", tool.parameters["properties"])

    def test_no_skills_loaded_message(self):
        tool = build_read_skill_tool([])
        self.assertIn("no skills", tool.description.lower())


# ── integration: built into the system prompt ────────────────────────


class SystemPromptIntegrationTests(unittest.TestCase):
    def setUp(self):
        from modkit.prompts.system import build_system_prompt

        self._tmp = Path(tempfile.mkdtemp(prefix="skills_int_"))
        self._build = build_system_prompt
        self._write_skill(self._tmp, "strict_lore", "Lock to canon lore.")

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_skill(self, root: Path, name: str, description: str) -> None:
        folder = root / name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {description}\n---\nbody content\n",
            encoding="utf-8",
        )

    def test_skills_param_injected(self):
        skills = discover_user_skills(self._tmp)
        prompt = self._build(skills=skills)
        self.assertIn("AVAILABLE SKILLS", prompt)
        self.assertIn("strict_lore", prompt)
        self.assertIn("Lock to canon lore.", prompt)
        # the body should NOT be in the prompt — only the description
        self.assertNotIn("body content", prompt)

    def test_empty_skills_param_omits_section(self):
        prompt = self._build(skills=[])
        self.assertNotIn("AVAILABLE SKILLS", prompt)


if __name__ == "__main__":
    unittest.main()

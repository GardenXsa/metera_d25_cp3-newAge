# Contributing to Chronicles of Meterea

## Commit Messages

All commit messages must follow these rules:

1. **Use conventional commit format**: `type(scope): description`
   - Types: `fix`, `feat`, `refactor`, `docs`, `test`, `chore`, `perf`, `security`
   - Scopes: `engine`, `ui`, `mods`, `save`, `ipc`, `data`, `config`, `test`

2. **Be descriptive**: Commit messages like "ххз", "fix", "wip" are not acceptable.
   - Bad: `ххз`, `fix stuff`, `update`, `asdf`
   - Good: `fix(save): resolve chunk parsing race condition on Windows`
   - Good: `feat(mods): add sandbox code scanner for dangerous patterns`

3. **Reference issues**: If the commit fixes a GitHub issue, include `Fixes #N` in the body.

4. **Language**: Commit messages should be in English. Code comments may be in Russian.

## Code Style

- JavaScript: 4-space indentation, single quotes for strings
- C++: 4-space indentation, snake_case for functions/variables
- JSON: 2-space indentation, consistent key naming (snake_case)

## Mod Development

- All mods must pass the sandbox code scanner (no `eval()`, `Function()`, `import()`, etc.)
- Use `ModAPI.*` methods instead of direct DOM/global access
- Mark deprecated APIs with `@deprecated` JSDoc tags

## Testing

- Run `node tests/test_stub_game.js` before submitting changes to inventory logic
- Run `node tests/ipc_security.test.js` for IPC validation changes
- Run `node tests/save_manager.test.js` for save system changes

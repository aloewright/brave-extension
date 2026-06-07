```markdown
# brave-extension Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you how to contribute to the `brave-extension` codebase, which is written in TypeScript and follows specific conventions for file naming, imports, exports, and testing. You'll learn the project's coding standards, how to structure new code, and how to write and run tests using `vitest`. While no automated workflows were detected, this guide provides suggested commands for common development tasks.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userSettings.ts`, `popupHandler.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { getUserSettings } from './userSettings'
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // In userSettings.ts
    export function getUserSettings() { ... }
    export const SETTINGS_KEY = 'settings'
    ```

### Commit Messages
- Use the `feat` prefix for new features.
  - Example: `feat: add popup handler for new tab`
- Commit messages are concise (average 46 characters).

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or module  
**Command:** `/add-feature`

1. Create a new TypeScript file using camelCase naming.
2. Implement your feature using named exports.
3. Use relative imports to include any dependencies.
4. Write corresponding tests in a `.test.ts` file.
5. Commit your changes with a `feat:` prefix in the message.

### Running Tests
**Trigger:** When you want to verify your changes  
**Command:** `/run-tests`

1. Ensure you have `vitest` installed.
2. Run the test suite:
    ```bash
    npx vitest
    ```
3. Review the output and fix any failing tests.

## Testing Patterns

- Tests are written in TypeScript using the `vitest` framework.
- Test files follow the `*.test.ts` naming convention.
  - Example: `userSettings.test.ts`
- Example test:
    ```typescript
    import { getUserSettings } from './userSettings'

    test('should return default settings', () => {
      expect(getUserSettings()).toEqual({ theme: 'light' })
    })
    ```

## Commands

| Command       | Purpose                                  |
|---------------|------------------------------------------|
| /add-feature  | Scaffold and commit a new feature/module |
| /run-tests    | Run the test suite with vitest           |
```
# Coding Conventions

**Analysis Date:** 2026-03-10

## Naming Patterns

**Files:**
- TypeScript/JavaScript files: kebab-case (e.g., `user-service.ts`, `auth-provider.tsx`)
- Test files: `.test.ts` or `.spec.ts` suffix (e.g., `user-service.test.ts`)
- Configuration files: lowercase with dots (e.g., `tsconfig.json`, `vitest.config.ts`)
- Directories: lowercase, kebab-case for multi-word names

**Functions:**
- camelCase for all functions and methods (e.g., `getUserById`, `calculateTotalPrice`)
- Private methods may be prefixed with underscore in some contexts
- Async functions follow camelCase convention (e.g., `fetchUserData`, `initializeApp`)

**Variables:**
- camelCase for all variable declarations (e.g., `userName`, `isLoading`, `maxRetries`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- Boolean variables: prefix with `is`, `has`, `can`, or `should` (e.g., `isActive`, `hasPermission`, `canDelete`)

**Types:**
- PascalCase for all type names, interfaces, and classes (e.g., `UserService`, `AuthConfig`, `ApiResponse`)
- Generic type parameters: Single uppercase letter or PascalCase (e.g., `T`, `U`, `TResult`)
- Enums: PascalCase for name and members (e.g., `UserRole`, `StatusCode`)

## Code Style

**Formatting:**
- Prettier 3.6.2 (`~3.6.2`)
- Single quotes (`singleQuote: true` in `.prettierrc`)
- Config file: `D:\projects\github\LayZeeDK\nx-openpolyrepo\.prettierrc`
- Prettier runs on save via VSCode extension (`esbenp.prettier-vscode` recommended)
- Ignore patterns: `/dist`, `/coverage`, `/.nx/cache`, `/.nx/workspace-data` (`.prettierignore`)

**Linting:**
- ESLint enabled via `@nx/eslint-plugin` (^22.5.4)
- No custom `.eslintrc` configuration currently — defaults apply
- TypeScript strict mode enabled in `tsconfig.base.json`
- Key TypeScript compiler options (all enabled):
  - `strict: true` — enforces all strict type-checking options
  - `noUnusedLocals: true` — error on unused local variables
  - `noImplicitReturns: true` — error on functions without explicit returns
  - `noFallthroughCasesInSwitch: true` — prevent switch fallthrough
  - `noImplicitOverride: true` — require explicit `override` keyword in subclasses
  - `isolatedModules: true` — ensure each file can be safely transpiled
  - `moduleResolution: "nodenext"` — use Node.js v18+ module resolution
  - `target: "es2022"` — compile to ES2022 features

## Import Organization

**Order:**
1. External packages (Node.js, npm modules): `import { something } from 'package-name'`
2. Relative imports from parent directories: `import { X } from '../../services'`
3. Relative imports from same/child directories: `import { Y } from './utils'`
4. Type imports: `import type { TypeName } from 'module'` (separate from value imports)

**Path Aliases:**
- Custom condition: `@nx-openpolyrepo/source` defined in `tsconfig.base.json`
- Use absolute imports where applicable via tsconfig path mappings
- Not yet configured with `@` or `~` aliases — add to `compilerOptions.paths` in `tsconfig.base.json` when needed

## Error Handling

**Patterns:**
- Errors should be typed (avoid `any`)
- Use specific error types when possible (e.g., `Error`, `TypeError`, `RangeError`)
- Async operations: use try/catch blocks for Promise-based code
- Validation: prefer early returns or guard clauses over deeply nested conditions
- Error messages: use clear, actionable language with context about what failed

## Logging

**Framework:** console (no structured logging library configured)

**Patterns:**
- Use `console.log()` for informational messages
- Use `console.error()` for error conditions
- Use `console.warn()` for warnings
- Use `console.debug()` for debug-only output (filtered in production)
- Avoid logging sensitive data (API keys, passwords, tokens)

## Comments

**When to Comment:**
- Explain WHY code does something, not WHAT it does (the code itself shows what)
- Document non-obvious algorithmic choices
- Explain business logic and domain-specific decisions
- Mark TODO, FIXME, or HACK items with context about what needs improvement
- Document complex workarounds with references to issues or tracking systems

**JSDoc/TSDoc:**
- Use JSDoc comments for exported functions, types, and classes
- Format: `/** Description */` for single-line, `/** ... */` for multi-line
- Include `@param`, `@returns`, `@throws`, and `@example` tags where helpful
- Document public API surfaces only; internal helpers can be minimal

## Function Design

**Size:**
- Keep functions small and focused (ideally under 20 lines)
- Single responsibility principle — one job per function
- Break complex operations into smaller helper functions

**Parameters:**
- Prefer object parameters for functions with 3+ arguments
- Use default parameters instead of checking for undefined
- Avoid boolean flags when possible — use named function overloads instead

**Return Values:**
- Always explicitly return a value or return nothing (don't mix)
- Use meaningful return types; avoid `any` and `unknown` when possible
- For async functions, always return a Promise typed with the result value

## Module Design

**Exports:**
- Use named exports over default exports for components and functions
- Default exports: acceptable for entry points and single-export modules
- Export type definitions alongside implementations
- Use `export type { TypeName }` for types to exclude from JavaScript bundle

**Barrel Files:**
- Create `index.ts` files to re-export public APIs from directories
- Barrel files location: `src/index.ts` for package entry point
- Example: `src/services/index.ts` re-exports all service classes
- Keep barrel files focused — export only public APIs, hide implementation details

---

*Convention analysis: 2026-03-10*

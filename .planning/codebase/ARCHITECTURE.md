# Architecture

**Analysis Date:** 2026-03-10

## Pattern Overview

**Overall:** Nx-based monorepo template for synthetic polyrepo management

**Key Characteristics:**
- Workspace-managed package structure using Nx 22.5.4
- TypeScript-first development with strict type checking
- Plugin-driven architecture (TypeScript, Vite, Vitest)
- Designed for managing multiple semi-independent projects
- Build caching and task orchestration via Nx
- ES2022 target compilation with Node.js ESM modules

## Layers

**Workspace Root:**
- Purpose: Central configuration and dependency management
- Location: `/`
- Contains: Workspace configuration, TypeScript base configs, package manager lockfile
- Depends on: Nothing (entry point)
- Used by: All packages in the monorepo

**Package Layer:**
- Purpose: Individual project packages managed by Nx
- Location: `/packages/`
- Contains: Individual TypeScript/JavaScript projects with their own configs
- Depends on: Shared workspace TypeScript and Nx plugins
- Used by: Workspace orchestration via Nx

**Build & Development Tools:**
- Purpose: Task execution, compilation, testing, linting
- Location: Implicit - controlled via `nx.json` plugins
- Contains: Nx plugins (@nx/js, @nx/vite, @nx/vitest)
- Depends on: Build tools (esbuild, vite, vitest)
- Used by: Every package's build, test, and development workflows

## Data Flow

**Package Discovery & Configuration:**

1. Nx reads `nx.json` workspace configuration
2. Plugins (@nx/js/typescript, @nx/vite/plugin) introspect package.json and project configs
3. TypeScript plugin auto-detects `tsconfig.lib.json` for build targets
4. Vite plugin auto-detects vite.config.* for dev/build targets
5. Task graph constructed with dependencies between packages

**Build Pipeline:**

1. Source TypeScript files in package `src/` directories
2. @nx/js plugin runs `tsc` for compilation via `build` target
3. ESBuild processes output (via esbuild option in nx.json)
4. Build artifacts written to `dist/` (default output path)
5. Nx caching layers prevent rebuilds for unchanged inputs

**Test Execution:**

1. @nx/vitest plugin discovers test files (*.spec.ts, *.test.ts)
2. Vitest runs tests with TypeScript support (@swc/core transpilation)
3. Test results cached based on production inputs (excluding test files)
4. Coverage collected via Istanbul

## Key Abstractions

**Workspace Configuration:**
- Purpose: Single source of truth for all Nx settings
- File: `nx.json`
- Pattern: Plugin-based configuration with named inputs, targets, and caching rules
- Controls: Task orchestration, input/output tracking, build caching

**TypeScript Configuration Hierarchy:**
- Purpose: Type checking and compilation configuration
- Base: `tsconfig.base.json` (shared compiler options)
- Root: `tsconfig.json` (extends base, manages project references)
- Per-Package: `tsconfig.lib.json`, `tsconfig.spec.json` (project-specific)
- Pattern: Strict settings (strict mode, noUnusedLocals, noImplicitReturns)

**Plugin System:**
- Purpose: Provide out-of-box support for languages and frameworks
- Examples: `@nx/js/typescript`, `@nx/vite/plugin`
- Pattern: Plugins auto-detect projects and generate targets
- Configuration: Plugin options in nx.json

## Entry Points

**Workspace Entry:**
- Location: `nx.json`
- Triggers: `nx` CLI invocation
- Responsibilities: Route to appropriate task, resolve dependencies, manage caching

**Package Execution:**
- Location: Individual `package.json` in `/packages/*`
- Triggers: Nx task targeting that package (e.g., `nx run my-package:build`)
- Responsibilities: Package-specific scripts and dependencies

**Build Entry:**
- Location: Each package's `src/` directory
- Triggers: `build` target execution
- Responsibilities: Compile TypeScript to distribution artifacts

## Error Handling

**Strategy:** Fail-fast with descriptive Nx CLI output

**Patterns:**
- TypeScript strict mode catches type errors at compile time
- Nx validates task dependencies before execution
- Plugin configuration errors surface during nx.json parsing
- Test framework (Vitest) provides detailed failure output with stack traces

## Cross-Cutting Concerns

**Logging:** Not configured at workspace level; packages may implement their own

**Validation:** TypeScript strict compiler flags enforce:
- Explicit return types
- No implicit any
- No unused variables
- No unused parameters (via configuration)
- Strict null/undefined checking

**Authentication:** Not applicable - this is a development/build tool

**Dependency Management:** Workspace lockfile (`package-lock.json`) ensures consistent versions across all packages

---

*Architecture analysis: 2026-03-10*

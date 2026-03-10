# Technology Stack

**Analysis Date:** 2026-03-10

## Languages

**Primary:**
- TypeScript 5.9.3 - Entire codebase (configured in `tsconfig.base.json` with ES2022 target)

## Runtime

**Environment:**
- Node.js 24.13.0 - Development and build-time

**Package Manager:**
- npm 11.6.2
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core - Monorepo Management:**
- Nx 22.5.4 - Polyrepo orchestration and caching
  - Workspace configuration: `nx.json`
  - Plugins installed: TypeScript, Vite, ESBuild

**Build & Dev:**
- Vite 7.3.1 - Modern bundler for projects
- ESBuild 0.25.12 - Fast TypeScript/JavaScript bundler
- SWC 1.15.18 - JavaScript/TypeScript compiler (@swc/core) with Node.js register (@swc-node/register)

**Testing:**
- Vitest 4.0.18 - Unit test runner (configured via `@nx/vitest` plugin)
- @vitest/ui 4.0.18 - Test UI dashboard

**Code Quality:**
- Prettier 3.6.2 - Code formatter
  - Configuration: `.prettierrc` (single quotes enabled)
  - Ignore rules: `.prettierignore` (dist, coverage, .nx/cache, workspace-data)
- @nx/eslint-plugin 22.5.4 - Linting via Nx

**Development Tools:**
- JITI 2.4.2 - Runtime TypeScript loader for dynamic imports

## Key Dependencies

**Critical:**
- @nx/devkit 22.5.4 - Nx plugin development API
- @nx/plugin 22.5.4 - Framework for building Nx plugins
- @nx/js 22.5.4 - JavaScript/TypeScript build and test target support
- @nx/node 22.5.4 - Node.js application support
- @nx/web 22.5.4 - Web application support
- @nx/workspace 22.5.4 - Workspace utilities and generators

**Support:**
- tslib 2.8.1 - TypeScript standard library
- @swc/helpers 0.5.19 - Runtime helpers for SWC transpilation

## Configuration

**Environment:**
- Workspace package manager: npm (see `workspaces` in `package.json`)
- Monorepo structure: Npm workspaces with `packages/*` pattern
- No environment variables required for core development

**Build:**
- TypeScript configuration: `tsconfig.base.json` (shared base, `tsconfig.json` extends it)
- Composite TypeScript builds enabled for incremental compilation
- Source maps generated for declarations (`declarationMap: true`)
- Strict mode enabled (`strict: true`)
- Module resolution: `nodenext` for modern Node.js compatibility
- ES2022 target with `es2022` library

**Plugins (nx.json):**
- `@nx/js/typescript` - Provides TypeScript build, test, and type-checking targets
- `@nx/vite/plugin` - Provides Vite-based build, dev, preview, and test targets
- Named inputs configured for production builds (excludes test files)

## Platform Requirements

**Development:**
- Node.js 24.x or compatible
- npm 11.6.x or compatible
- Windows, macOS, or Linux (cross-platform)

**Production:**
- Self-hosted Nx cache support (no Nx Cloud or Enterprise required)
- Works with synthetic monorepos and polyrepos

---

*Stack analysis: 2026-03-10*

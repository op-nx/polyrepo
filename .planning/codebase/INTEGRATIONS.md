# External Integrations

**Analysis Date:** 2026-03-10

## APIs & External Services

**None detected** - This is an Nx plugin/monorepo management tool with no external API integrations.

## Data Storage

**Databases:**
- Not applicable - This is a development/build tool, not a runtime application

**File Storage:**
- Local filesystem only - Uses local caching via `.nx/cache` and workspace-data directories

**Caching:**
- Nx local cache - Configured in `nx.json`
- Support for self-hosted Nx cache (mentioned in README.md)
- Default cache location: `.nx/cache`

## Authentication & Identity

**Auth Provider:**
- Not applicable - No runtime authentication required
- Nx Cloud/Enterprise optional (not required)

## Monitoring & Observability

**Error Tracking:**
- None - Development-time tool only

**Logs:**
- Console output from build and test tasks

## CI/CD & Deployment

**Hosting:**
- Self-hosted (for cache) - Nx supports self-hosted caching without Nx Cloud/Enterprise
- No pre-built CI/CD workflows detected

**CI Pipeline:**
- Not detected - No `.github/workflows/`, GitLab CI, or other CI configurations present
- Projects created from this plugin would define their own CI/CD

## Environment Configuration

**Required env vars:**
- None - The workspace is self-contained with no external dependencies

**Secrets location:**
- Not applicable

## Webhooks & Callbacks

**Incoming:**
- None - Not a runtime service

**Outgoing:**
- None - Not a runtime service

## Nx Workspace Integration

**Core Integrations:**
- npm workspaces - Primary integration point for package management
- Nx plugins architecture - Extensible plugin system for adding custom targets/executors
- TypeScript - Deep integration for type-safe builds and generators
- Prettier - Code formatting in generated code
- ESLint plugin - Linting configuration via Nx

## Development-Time Tools Integration

**Package Management:**
- npm - Primary package manager
- Workspace: `packages/*` pattern in `package.json`

**Build System:**
- Nx executor system - Provides targets: build, test, typecheck, serve, etc.
- Vite - For web application projects
- ESBuild - For general bundling
- SWC - For fast transpilation

**Testing Framework:**
- Vitest - Test runner with UI dashboard support

**Code Quality:**
- TypeScript strict mode - Enforced in `tsconfig.base.json`
- Prettier - Code formatting
- ESLint - Via Nx plugin

---

*Integration audit: 2026-03-10*

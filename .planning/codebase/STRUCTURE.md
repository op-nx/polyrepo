# Codebase Structure

**Analysis Date:** 2026-03-10

## Directory Layout

```
nx-openpolyrepo/
├── .claude/              # AI agent configuration
│   └── settings.json     # AI-specific settings
├── .vscode/              # Editor configuration
│   └── extensions.json   # Recommended VS Code extensions
├── .git/                 # Git repository (ignored in this analysis)
├── .planning/            # Planning documents
│   └── codebase/         # Codebase analysis documents
├── packages/             # Monorepo packages (empty template)
│   └── .gitkeep          # Placeholder for future packages
├── node_modules/         # Installed dependencies (gitignored)
├── AGENTS.md             # Guidelines for working with Nx
├── CLAUDE.md             # Project-specific instructions
├── README.md             # Project overview
├── nx.json               # Nx workspace configuration
├── package.json          # Workspace root package
├── package-lock.json     # Dependency lock file
├── tsconfig.base.json    # Base TypeScript configuration
├── tsconfig.json         # Root TypeScript configuration
├── .gitignore            # Git ignore rules
├── .prettierrc            # Prettier formatting configuration
└── .prettierignore       # Prettier ignore rules
```

## Directory Purposes

**`.claude/`:**
- Purpose: AI agent configuration and settings
- Contains: JSON configuration files for Claude code agents
- Key files: `settings.json` - agent behavior and tool permissions

**`.vscode/`:**
- Purpose: IDE integration and developer experience
- Contains: VS Code workspace configuration and recommendations
- Key files: `extensions.json` - recommended extensions (Angular Console, Prettier)

**`.planning/`:**
- Purpose: GSD workflow planning and codebase documentation
- Contains: Phase plans, milestone tracking, and architectural analysis
- Key files: `codebase/` directory for architecture, structure, and conventions documents

**`packages/`:**
- Purpose: Container for individual monorepo packages
- Contains: TypeScript/JavaScript projects managed by Nx
- Key files: Each package will have `package.json`, `src/`, `tsconfig.lib.json`, `tsconfig.spec.json`
- Currently: Empty with `.gitkeep` placeholder

## Key File Locations

**Entry Points:**
- `nx.json`: Workspace configuration - defines all tasks, plugins, and defaults
- `package.json`: Root workspace manifest with Nx plugins and dev dependencies

**Configuration:**
- `tsconfig.base.json`: Base TypeScript compiler options shared across all packages
- `tsconfig.json`: Root TypeScript configuration extending base
- `.prettierrc`: Code formatting rules (single quotes enabled)
- `.prettierignore`: Files excluded from formatting
- `.gitignore`: Git exclusion patterns (dist/, node_modules/, .nx/cache/)

**Core Logic:**
- This is a template/scaffold project - core logic lives in packages created under `/packages/*/src/`

**Testing:**
- Configured via `@nx/vitest` plugin in `nx.json`
- Test files located in `/packages/*/src/**/*.spec.ts` or `*.test.ts`

## Naming Conventions

**Files:**
- Configuration: kebab-case with descriptive prefixes (e.g., `tsconfig.lib.json`, `tsconfig.spec.json`)
- TypeScript sources: camelCase (not enforced by config, but standard Node.js)
- Package names: kebab-case with scope prefix (e.g., `@nx-openpolyrepo/package-name`)

**Directories:**
- Workspace directories: kebab-case (`.vscode`, `.planning`, `node_modules`)
- Source files: `src/` as standard convention
- Built output: `dist/` (Nx default)
- Distribution types: `lib` for libraries, `app` for applications

**TypeScript Config Files:**
- `tsconfig.base.json` - Shared base configuration
- `tsconfig.lib.json` - Library-specific configuration (per package)
- `tsconfig.spec.json` - Test-specific configuration (per package)

## Where to Add New Code

**New Package:**
1. Create directory under `/packages/{package-name}/`
2. Initialize `package.json` with:
   - `"name": "@nx-openpolyrepo/{package-name}"`
   - `"version": "0.0.0"` (matches workspace)
   - `"license": "MIT"`
   - `"private": true`
3. Create project structure:
   ```
   packages/{package-name}/
   ├── src/
   │   ├── index.ts       # Main export
   │   └── lib.ts         # Core implementation
   ├── src/tests/         # Or use src/**/*.spec.ts
   │   └── lib.spec.ts
   ├── tsconfig.json      # Extends ../../../tsconfig.base.json
   ├── tsconfig.lib.json  # Build configuration
   ├── tsconfig.spec.json # Test configuration
   ├── vite.config.ts     # (Optional, if using Vite)
   └── vitest.config.ts   # (Optional, if using Vitest)
   ```
4. Add path alias in `tsconfig.base.json`:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@nx-openpolyrepo/{package-name}": ["packages/{package-name}/src/index.ts"]
       }
     }
   }
   ```

**New Module/Feature in Existing Package:**
- Location: `/packages/{package-name}/src/` (create subdirectories as needed)
- Pattern: One feature per file or subdirectory
- Exports: Use barrel files (`index.ts`) for public API
- Tests: Co-locate with implementation (`.spec.ts` suffix)

**Shared Utilities:**
- Location: Create dedicated package under `/packages/shared-utils/` or similar
- Purpose: Utilities imported across multiple packages
- Pattern: Namespace by purpose (e.g., `@nx-openpolyrepo/utils-validation`)

**Build Artifact:**
- Location: `/packages/{package-name}/dist/` (Nx manages automatically)
- Contents: Compiled JavaScript, declaration files (.d.ts), source maps
- Not committed: `.gitignore` excludes `dist/`

## Special Directories

**`.nx/`:**
- Purpose: Nx workspace metadata and build cache
- Generated: Yes (created during `npm install` and workspace operations)
- Committed: Partially
  - `.nx/workspace-data/`: Cached project graph (in `.gitignore`)
  - `.nx/cache/`: Build cache (in `.gitignore`)
  - `.nx/polygraph/`: Polyrepo configuration (referenced but not committed)

**`node_modules/`:**
- Purpose: Installed npm dependencies
- Generated: Yes (via `npm install`)
- Committed: No (in `.gitignore`)

**`dist/`:**
- Purpose: Build output for each package
- Generated: Yes (via `nx run {package}:build`)
- Committed: No (in `.gitignore`)

## Plugin Configuration Reference

**Plugins active in `nx.json`:**

1. `@nx/js/typescript`:
   - Provides: `build`, `typecheck`, `build-deps`, `watch-deps` targets
   - Config path: `tsconfig.lib.json` per package
   - Output: Compiled JavaScript in `dist/`

2. `@nx/vite/plugin`:
   - Provides: `build`, `test`, `serve`, `dev`, `preview` targets
   - For: Web projects and libraries using Vite
   - Vitest: Integrated as `test` target via this plugin

## Development Workflow

**Run a task:**
```bash
npm exec nx run {package}:{target}
npm exec nx run {package}:build
npm exec nx run {package}:test
```

**Run multiple tasks:**
```bash
npm exec nx run-many --targets=build --projects={package1},{package2}
npm exec nx affected --targets=build              # Only changed packages
```

**Watch mode:**
```bash
npm exec nx run {package}:watch-deps              # Watch dependencies
npm exec nx run {package}:dev                     # Dev server (Vite)
```

---

*Structure analysis: 2026-03-10*

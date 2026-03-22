# Deferred Items - Phase 10

## Nx task hasher crash with cross-repo edges in gitignored .repos/

**Found during:** 10-03 Task 1
**Severity:** Medium (local dev workflow, not production/CI)

After relaxing the fileMap guard in createDependencies, `nx test` and `nx lint` crash locally with "project nx/devkit not found" from NativeTaskHasherImpl. This happens because:

1. Local workspace has `.repos/` in `.gitignore`
2. Nx's file indexer respects `.gitignore`, so external project files are not indexed
3. The native task hasher crashes when it encounters projects without file entries

**Not a regression for Docker e2e:** In Docker, `.repos/` is NOT in `.gitignore`, so Nx indexes files normally and the task hasher works.

**Workarounds:**

- Run vitest directly: `node node_modules/vitest/vitest.mjs run --config packages/op-nx-polyrepo/vitest.config.mts`
- Run eslint directly: `node node_modules/eslint/bin/eslint.js <files>`
- Remove `.repos/` directory from local workspace

**Future fix options:**

1. Inject synthetic file entries for external projects so the task hasher can process them
2. Use Nx's `externalNodes` mechanism instead of regular project registration
3. Ensure `.repos/` is not in `.nxignore` to let Nx index files even if `.gitignore` excludes them

# Research: Bypassing pnpm Preinstall Scripts in Cloned Monorepos

**Context:** e2e tests clone nrwl/nx and run `corepack pnpm install --frozen-lockfile`. The nx repo has a `preinstall` script (`scripts/preinstall.js`) that checks for Node 20+, pnpm 10+, and Rust (`rustc`). The script exits 0 early if `process.env.CI` is truthy.
**Researched:** 2026-03-16
**Overall confidence:** HIGH

## The Preinstall Script (Verified)

Source: https://github.com/nrwl/nx/blob/master/scripts/preinstall.js

```js
if (process.env.CI) {
  process.exit(0);
}
// ... checks Node, pnpm, then rustc
// exits non-zero if rustc missing or < 1.70
```

This is a **root workspace script**, not a dependency lifecycle script. This distinction matters because pnpm v10's `onlyBuiltDependencies` / `neverBuiltDependencies` only control **dependency** lifecycle scripts -- they have zero effect on root project scripts.

---

## Solutions (Ranked by Recommendation)

### 1. `ENV CI=true` in Dockerfile (RECOMMENDED)

**How:** Add `ENV CI=true` to the Dockerfile (or the stage that runs tests).

**Why it works:** The nx preinstall script explicitly checks `process.env.CI` and exits 0 immediately, skipping all checks including Rust.

**Side effects of `CI=true`:**

| Tool | Behavior Change | Impact |
|------|----------------|--------|
| pnpm | Implies `--frozen-lockfile` (fails if lockfile needs update) | **None** -- we already pass `--frozen-lockfile` |
| pnpm | Suppresses TTY prompts / `approve-builds` interactive mode | **Positive** -- we want non-interactive |
| pnpm | Auto-detects CI, adjusts output formatting | **Neutral** |
| npm | No significant install behavior change | **None** |
| react-scripts | `build` treats warnings as errors | **N/A** -- not building React apps |
| Jest / Vitest | May change watch mode behavior | **N/A** -- not running nx's tests |
| Husky | `prepare` script uses `is-ci` to skip hook install | **Positive** -- avoids unnecessary husky setup |

**Verdict:** `CI=true` is safe and idiomatic for a container that exclusively runs automated tests. The side effects are either positive or irrelevant.

**Confidence:** HIGH -- verified from the actual script source code.

```dockerfile
# In your Dockerfile or test stage
ENV CI=true
```

### 2. `ignore-scripts=true` in `.npmrc` (Placed in Prebaked Repo)

**How:** Add a `.npmrc` file with `ignore-scripts=true` inside the prebaked `/repos/nx` directory (or in the user home `~/.npmrc` inside the container).

**Why it works:** pnpm reads `.npmrc` and will skip ALL lifecycle scripts, including the root `preinstall`.

**Where to place it:**
- `/repos/nx/.npmrc` (project-level, highest file precedence) -- survives clone if committed to the prebaked repo
- `~/.npmrc` (user-level) -- applies to all pnpm installs in the container

**Config precedence (high to low):**
1. CLI flags (`--ignore-scripts`)
2. Environment variables (`pnpm_config_ignore_scripts=true`)
3. `pnpm-workspace.yaml` (`ignoreScripts: true`)
4. Project `.npmrc` (`ignore-scripts=true`)
5. User `~/.npmrc`
6. Global npm config

**Downside:** This disables ALL scripts -- including `prepare`, `postinstall`, etc. If any dependency needs a build step (native modules like `sharp`, `esbuild`, etc.), those will also be skipped. For a prebaked repo where deps are already installed, this may be acceptable since we only need pnpm to verify the lockfile and link packages.

**Confidence:** HIGH -- documented in pnpm settings page.

### 3. `ignoreScripts: true` in `pnpm-workspace.yaml` (Placed in Prebaked Repo)

**How:** Edit the `pnpm-workspace.yaml` in the prebaked `/repos/nx` to add `ignoreScripts: true`.

**Why it works:** Same as `.npmrc` but using the modern pnpm v10+ recommended config location. Takes precedence over `.npmrc`.

**Same downside as option 2** -- blocks all scripts.

**Confidence:** HIGH -- documented on https://pnpm.io/settings.

### 4. Git-Level: Remove Preinstall from Prebaked Repo

**How:** In the Docker build, after cloning nx, remove the preinstall script from `package.json` and commit:

```dockerfile
RUN cd /repos/nx \
    && node -e "const p=require('./package.json'); delete p.scripts.preinstall; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n')" \
    && git add package.json \
    && git commit -m "Remove preinstall check for e2e"
```

**Why it works:** When the test clones from this local repo, the clone inherits the modified `package.json` without the preinstall script.

**Downside:** Fragile -- if the prebaked commit is on a specific branch/tag, this adds a divergent commit. But for a test fixture, this is acceptable.

**Confidence:** HIGH -- basic git behavior.

### 5. Environment Variable `pnpm_config_ignore_scripts=true`

**How:** Set in Dockerfile:
```dockerfile
ENV pnpm_config_ignore_scripts=true
```

**Why it works:** pnpm reads `pnpm_config_*` env vars as configuration overrides. This is equivalent to `--ignore-scripts` on every pnpm command.

**Same downside as options 2-3** -- blocks all scripts globally.

**Confidence:** MEDIUM -- documented for npm config convention, pnpm inherits this pattern, but not explicitly documented for all settings.

---

## Solutions That Do NOT Work

### `onlyBuiltDependencies` / `neverBuiltDependencies`
These only control **dependency** lifecycle scripts (packages in `node_modules`). The nx `preinstall` is a **root workspace** script -- it runs as part of the workspace's own package.json, not as a dependency. These settings have no effect.

### `.pnpmfile.cjs` `readPackage` Hook
The `readPackage` hook mutates dependency manifests during resolution. It does NOT affect the root workspace's own `package.json` scripts. Even for dependencies, pnpm reads the package.json from the archive for build purposes, not the hooked version. So removing `scripts.preinstall` via `readPackage` does not prevent the script from running.

### `enable-pre-post-scripts=false`
This controls whether `pre*` and `post*` variants of user-defined scripts run (e.g., `prebuild` when you run `pnpm build`). It does NOT affect the built-in `preinstall` lifecycle hook, which is triggered by `pnpm install` regardless of this setting.

---

## Recommendation

**Use `ENV CI=true` in the Dockerfile.** Rationale:

1. **Surgical:** Only bypasses the specific check in nx's preinstall script. All other scripts (prepare, postinstall for native deps) still run normally.
2. **Idiomatic:** This is the officially supported bypass in nx's own script. They expect CI environments to set this.
3. **No side effects for our use case:** The container is dedicated to e2e tests. `CI=true` makes pnpm behavior more predictable (frozen lockfile implied, no interactive prompts).
4. **No repo modification needed:** Unlike the git-level approach, we don't modify the prebaked repo at all.
5. **Zero maintenance:** If nx changes their preinstall script, they'll preserve the CI bypass since their own CI needs it.

If `CI=true` causes unexpected issues elsewhere in the container (unlikely but possible), fall back to **option 4** (remove preinstall from prebaked repo via git commit).

---

## Sources

- [nrwl/nx preinstall.js](https://github.com/nrwl/nx/blob/master/scripts/preinstall.js) -- verified script source
- [pnpm Settings](https://pnpm.io/settings) -- `ignoreScripts`, `ignoreDepScripts`, `enablePrePostScripts` documentation
- [pnpm .pnpmfile.cjs](https://pnpm.io/pnpmfile) -- `readPackage` hook limitations
- [pnpm #3063: ignore-scripts in .npmrc](https://github.com/pnpm/pnpm/issues/3063) -- `.npmrc` support history
- [pnpm #10308: ignore-scripts npm vs pnpm](https://github.com/pnpm/pnpm/issues/10308) -- config inheritance behavior
- [pnpm v10 blocks lifecycle scripts by default](https://socket.dev/blog/pnpm-10-0-0-blocks-lifecycle-scripts-by-default) -- v10 security model
- [pnpm #9435: CI=true and approve-builds](https://github.com/pnpm/pnpm/issues/9435) -- CI env var behavior

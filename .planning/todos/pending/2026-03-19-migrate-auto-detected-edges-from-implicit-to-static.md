---
created: "2026-03-19T11:40:31.322Z"
title: Migrate auto-detected edges from implicit to static
area: detection
files:
  - packages/op-nx-polyrepo/src/lib/graph/detect.ts:388,508
  - packages/op-nx-polyrepo/src/index.ts:130
  - packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts
  - packages/op-nx-polyrepo/src/index.spec.ts
  - packages/op-nx-polyrepo-e2e/src/cross-repo-deps.spec.ts
---

## Problem

All cross-repo dependency edges (auto-detected from package.json, tsconfig path aliases) use `DependencyType.implicit`. Phase 9 originally decided on `DependencyType.static` for dep-list edges but the implementation used `implicit` throughout. Auto-detected edges from source file analysis (package.json declarations, tsconfig paths) are semantically static dependencies — they come from analyzing specific source files, not from manual user configuration.

Using `implicit` loses provenance information: `nx affected` cannot trace which file created the edge. `static` edges carry a `sourceFile` field pointing to the declaring package.json or tsconfig, giving Nx better information for change impact analysis.

## Solution

- Change `DependencyType.implicit` to `DependencyType.static` for auto-detected edges in `detect.ts` (lines 388, 508)
- Keep `DependencyType.implicit` for user-configured override edges (these have no natural source file)
- Ensure `sourceFile` is set on all static edges (already provided for auto-detected edges)
- Update ~30 test assertions across detect.spec.ts, index.spec.ts
- Update 3 e2e tests in cross-repo-deps.spec.ts (filter for `type === 'static'` or accept both types)
- Validate that `static` edges require `sourceFile` per Nx validation rules (confirmed in research)
- Consider: does this improve `nx affected` behavior for cross-repo changes? (likely blocked by DETECT-07 regardless)

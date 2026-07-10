# Henosis platform

This repository is the pnpm monorepo scaffold for the Henosis PoC platform packages.

- `packages/core` publishes `@henosis/core`: the D23 transactional record seam, typed component definitions, environment grammar, definition-identity refs, world resolution, validation, and resolved-record projection.
- `packages/platform-mock` publishes `@henosis/platform-mock`: the zero-capability test/live-transition platform, including the marked v1 callback adapter.
- `packages/platform-k8s` publishes `@henosis/platform-k8s`: namespace/service capabilities and deterministic Kubernetes YAML for Deployment, Service, HPA, PDB, and Namespace records.
- `packages/renderer` publishes `@henosis/renderer`: manifest rendering plus the widened blocking gate matrix and its dev-only kill switch.

Use Node >=22. Enable pnpm through Corepack:

```sh
corepack enable
pnpm install
pnpm -r build
```

## Resolution mechanics

Service workspaces declare `@henosis/platform-mock` and sibling `@henosis/*` dependencies using pnpm git dependencies with path selectors, for example `github:org/repo#path:subdir`.

For local development, these dependencies resolve to the current HEAD of each referenced repo. The renderer assembles a temporary workspace and generates pnpm overrides to pin every `@henosis/*` package to the exact git commit selected by a manifest entry, for example `github:org/repo#<sha>&path:subdir`.

That lets any component package be pinned to an arbitrary git ref from the manifest. The invariant is that the renderer's generated overrides fully control which version of every component the assembled workspace resolves to.

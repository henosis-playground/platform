# Henosis platform

This repository is the pnpm monorepo scaffold for the Henosis PoC platform packages.

- `packages/core` publishes `@henosis/core`: typed component definitions, the `h` schema vocabulary, output refs, and the pure evaluation interface consumed by the renderer.
- `packages/platform-mock` publishes `@henosis/platform-mock`: the zero-capability PoC platform package that components import.
- `packages/renderer` publishes `@henosis/renderer`: a manifest-driven renderer and gate CLI.

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

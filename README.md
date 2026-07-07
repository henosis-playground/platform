# Henosis platform

This repository is the pnpm monorepo scaffold for the Henosis PoC platform packages.

- `packages/sdk` publishes `@henosis/sdk`. The SDK will hold typed component definitions: the contract surface, environment types, builders, and conventions used by component workspaces.
- `packages/renderer` publishes `@henosis/renderer`. The renderer is intended to be a pure function of one lockfile: it reads a single environment lockfile and produces rendered output for that environment.

Use Node >=22. Enable pnpm through Corepack:

```sh
corepack enable
pnpm install
pnpm -r build
```

## Resolution mechanics

Service workspaces declare `@henosis/sdk` and sibling `@henosis/*` dependencies using pnpm git dependencies with path selectors, for example `github:org/repo#path:subdir`.

For local development, these dependencies resolve to the current HEAD of each referenced repo. The renderer assembles a temporary workspace and generates pnpm overrides to pin every `@henosis/*` package to the exact git commit selected by a lockfile entry, for example `github:org/repo#<sha>&path:subdir`.

That lets any component package be pinned to an arbitrary git ref from the lockfile. The invariant is that the renderer's generated overrides fully control which version of every component the assembled workspace resolves to.

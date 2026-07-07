# Henosis platform

This repository is the pnpm monorepo scaffold for the Henosis PoC platform packages.

- `packages/sdk` publishes `@henosis/sdk`. The SDK will hold typed component definitions: the contract surface, environment types, builders, and conventions used by component workspaces.
- `packages/renderer` publishes `@henosis/renderer`. The renderer is intended to be a pure function of one lockfile: it reads a single environment lockfile and produces rendered output for that environment.

This scaffold intentionally does not implement SDK or renderer logic. Those APIs come later from the PoC spec.

Use Node >=22. Enable pnpm through Corepack:

```sh
corepack enable
pnpm install
pnpm -r build
```

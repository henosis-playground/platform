# Henosis TypeScript authoring SDK

This repository implements the D26 authoring boundary. Components are synchronous pure desire
functions: declared inputs in, complete resources and outputs out. Bundling and Rust isolate
execution live elsewhere.

- `packages/core` — `defineComponent`, `defineResource`, typed input/output declarations, total
  resource emission, canonical serialization, the host protocol implementation, and an in-process
  fake host.
- `packages/platform-cloudflare` — typed Worker, Tunnel, and Route resource kinds.
- `packages/platform-k8s` — `k8s/object@1` passthrough plus optional Deployment/Service sugar.
- `packages/platform-supabase` — owned schema resources and native SQL migration references.
- `examples/benchmark` — multiple components in one ordinary TypeScript package, including the
  backend/frontend/Supabase/tunnel and two-service benchmark shapes.

The Rust-side contract is specified in [HOST-PROTOCOL.md](./HOST-PROTOCOL.md).

```sh
corepack enable
pnpm install
pnpm build
pnpm test
```

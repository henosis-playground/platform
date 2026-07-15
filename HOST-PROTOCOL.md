# Henosis TypeScript isolate host protocol v1

This document is the contract between a bundled TypeScript component and the Rust `deno_core`
host. It is normative for protocol version `1`. The TypeScript declarations live in
`@henosis/core`; this document states the host obligations that types alone cannot express.

## 1. Execution and trust model

A component is a synchronous pure desire function. One evaluation consumes one immutable input
snapshot and returns complete resources, static outputs, observed-output bindings, and the exact
inputs read. The host MUST run it in an isolate with no network, filesystem, environment variables,
clock, timers, randomness, subprocesses, dynamic module loading, or mutable state shared with another
evaluation. The bundle closure and snapshot are the only inputs.

The same bundle bytes and byte-identical canonical snapshot MUST produce byte-identical successful
or blocked results. A fresh isolate (or a provably reset realm) MUST be used for each attempt. The
host MUST impose memory, CPU, stack, and output-size limits and report limit failures as host
failures, never as `blocked`.

Components are synchronous in v1. A returned Promise is an author error. The host MUST NOT keep the
isolate alive for asynchronous work after `evaluate` returns.

## 2. Bundle module shape

The CLI/bot generates an entry module; author modules do not hand-write this wrapper.

```ts
export const protocolVersion = 1;
export const component: ComponentMetadataWire;
export function evaluate(snapshot: EvaluationSnapshot): EvaluationResult;
```

This is the shape returned by `createBundle(component)`. The host MUST reject a missing export,
unknown protocol version, duplicate component name, or metadata that is not plain JSON-compatible
data. Functions appear only at `evaluate`; metadata contains no executable values.

`component.inputs` maps local input names to one of two metadata shapes:

```ts
type InputMetadataWire =
  | { component: string; output: string; optional: boolean }
  | { source: "config"; schema: SchemaWire; default?: { value: JsonValue } };
```

The first shape consumes another component's output. The second declares a graph-supplied literal;
the wrapper around `default.value` distinguishes a missing default from a JSON `null` default.
`component.outputs` maps output names to `{ availability, optional, schema }`. The host uses this
metadata to validate graph wiring and literal bindings before execution.

`component.files` lists configuration content in the evaluation closure as
`{ path, sha256 }`. The bundler computes every digest, copies the exact bytes beside the bundle, and
includes the sorted file manifest in bundle identity; an optional author digest is only a cross-check.
The SDK must reject a declared file omitted by the bundler, an undeclared supplied file, and a resource
configuration-file reference that does not resolve in this list. Controllers read these bytes through
a verified configuration-closure reader keyed by bundle digest and path, never from a checkout.
Workload executables and assets are not component files: resources reference those separately by
artifact kind and content digest, and graph-supplied config bindings carry those digests into `build()`.

Component names and resource logical names match `^[a-z][a-z0-9_-]{0,62}$` because they flow into
target identifiers. Input and output names are TypeScript API surface and match
`^[A-Za-z][A-Za-z0-9]{0,62}$`; idiomatic camelCase is recommended. Source coordinates apply the
component rule to `component` and the API rule to `output`.

## 3. Snapshot injection

```json
{
  "protocolVersion": 1,
  "inputs": {
    "databaseUrl": { "state": "available", "value": "https://example.test/rest/v1" },
    "previewUrl": { "state": "absent" },
    "workerUrl": { "state": "blocked" }
  }
}
```

The host MUST provide exactly one cell for every declared local input and no extra cells.

- `available`: either a producer output is concrete, or the graph supplied a config literal (or the
  declaration's default was selected). Output values MUST satisfy the producer schema; config values
  MUST satisfy the config input's own schema. Both sources are intentionally indistinguishable to
  component code after snapshot construction.
- `blocked`: an output-sourced input is present/required but not concrete yet, normally because a
  controller has not published an observed output for this generation. Config inputs are never
  `blocked`.
- `absent`: an optional producer output is known not to exist in this generation. It is invalid for
  a required or config input.

Presence is a plan-time fact, not a value read. For an optional input, `.present` is `false` only for
`absent`; it is `true` for both `available` and `blocked`. Authors may branch on `.present` without
creating a dependency read. Reading `.value` records the local input name and either returns the
available value, throws `Blocked`, or produces an author error for an absent value.

Generation fencing is external to the isolate. The host MUST only use outputs carrying the same
graph generation as the evaluation. An output from generation N MUST never enter a generation N+1
snapshot, even when component and output names match. A changed config binding is likewise a new
graph generation; the host MUST rebuild the snapshot and re-evaluate rather than mutating an accepted
plan in place.

At graph acceptance, the host MUST reject and aggregate all missing required config bindings, bindings
to undeclared or output-sourced inputs, and schema mismatches. A declared default is used only when the
graph omits that input. Explicit graph bindings override defaults. Diagnostics MUST name the component,
local input, expected schema, and received JSON kind when a value is present but invalid.

## 4. Input handle semantics

Build code receives handles, not raw values:

```ts
inputs.databaseUrl.value       // inspection; records a read
inputs.previewUrl.present      // legal presence fact; no read
inputs.previewUrl.value        // inspection; may block
```

This explicit `.value` seam is deliberate. JavaScript proxies cannot trap object truthiness
(`if (proxy)` is always truthy), so a raw value-shaped proxy cannot honestly guarantee that every
branch is observed. A handle makes the inspection point enforceable and keeps read tracking exact.
Property access, string operations, arithmetic, coercion, or branching happen after `.value` returns
concrete data; if unavailable, the getter throws first.

Passing an input handle itself into a resource or static output is misuse. If its cell is `blocked`,
serialization throws the typed `Blocked` signal (because totality required inspection). If concrete,
it throws `HENOSIS_INPUT_HANDLE_SERIALIZED` with a repair suggesting `.value`. There are no deferred
slots in a resource body.

## 5. Resource emission and transaction

`context.emit(resourceIntent)` validates and snapshots the entire resource synchronously. A resource
is appended only after every body field has become finite JSON and the body has been recursively
canonicalized. Therefore an individual resource is atomic and total.

The sink is core-owned and follows an open → sealed or open → aborted transaction:

- successful evaluation seals all emitted resources;
- `Blocked` seals and returns the already-complete prefix;
- any other exception aborts and discards all resources;
- writes after seal/abort are errors.

The stable author address is `kind/name`, where kind includes its version, for example
`cloudflare/worker@1/backend`. Duplicate addresses in one evaluation are errors. The TypeScript side
does not mint TypeIDs because evaluation has no RNG and must not depend on host time. Rust MUST map
the stable tuple `(graph component instance, kind, logical name)` to the resource TypeID used in the
plan, preserving an existing binding across generations. The display path is
`component-instance/kind/name`. A changed kind or name denotes a new resource, not a rename.

Each emission contains:

```json
{
  "address": "cloudflare/worker@1/backend",
  "kind": "cloudflare/worker@1",
  "name": "backend",
  "body": { "source": { "entry": { "kind": "cloudflare-worker", "digest": "sha256:0123..." } } },
  "canonical": "{\"source\":{\"entry\":{\"digest\":\"sha256:0123...\",\"kind\":\"cloudflare-worker\"}}}"
}
```

Rust MUST verify that `canonical` is the canonical serialization of `body` before hashing or
accepting it. It MAY recompute and ignore the supplied string; mismatch MUST fail closed. Object keys
sort by UTF-16/Unicode code-unit order, recursively. Array order is preserved. Numbers are finite
JSON numbers; `NaN`, infinities, `undefined`, bigint, functions, symbols, class instances, and cycles
are forbidden.

## 6. Outputs

A component declares every output as `static` or `observed`, independently optional or required.

- Static outputs are concrete JSON returned by the build and schema-checked in the SDK.
- Observed outputs are not author values. The build returns a binding obtained from
  `context.emit(...).outputs.<name>`. The result serializes that as `{ resource, output }`.

A complete result separates these channels:

```json
{
  "status": "complete",
  "outputs": { "workerName": "backend" },
  "observedOutputs": {
    "url": { "resource": "cloudflare/worker@1/backend", "output": "url" }
  }
}
```

Rust MUST ensure every observed binding names a resource emitted by the same evaluation. Controllers
publish values against the final TypeID, kind output name, and generation. Rust then exposes the
published value as the component output named by the binding. Authors cannot write observed values.
Optional outputs omitted from the build are known absent for that generation. Required outputs may
never be omitted.

## 7. Results

Complete:

```json
{
  "protocolVersion": 1,
  "status": "complete",
  "resources": [],
  "outputs": {},
  "observedOutputs": {},
  "reads": ["databaseUrl"]
}
```

Blocked:

```json
{
  "protocolVersion": 1,
  "status": "blocked",
  "resources": [],
  "blocked": {
    "code": "HENOSIS_BLOCKED",
    "input": "databaseUrl",
    "source": "database.restUrl",
    "operation": "reading `.value`",
    "message": "..."
  },
  "reads": ["databaseUrl"]
}
```

`reads` is the sorted set of local input names whose `.value` getter was entered. It includes
available reads and the blocked read. It excludes presence checks. Rust resolves each local name
through `component.inputs` to construct the observed dependency graph. Rust MUST retain the emitted
prefix and blocked marker in the current plan interpretation, and re-run from a fresh isolate when a
relevant value becomes available. It MUST NOT append later resources to the old result; every retry
replaces that component's interpretation atomically.

A `Blocked` signal is control flow, not component failure. The host SHOULD detect it by the returned
`status`, not by parsing exception text. All other uncaught exceptions are evaluation failures.

Before invoking the bundle, the host MUST install a synchronous, non-configurable global function
named `__henosis_mark_blocked(detail)`. Its payload is exactly the blocked detail without the wire
`code` field:

```ts
interface HostBlockedDetail {
  input: string;
  source: string;
  operation: string;
  message: string;
}
```

Immediately before throwing `Blocked`, the SDK MUST call this function when it is present. This
applies both when a blocked input's `.value` getter is read and when serialization encounters a
blocked input handle. The host MUST retain the first detail reported during an evaluation. If author
code catches and swallows the exception and returns `complete`, the host MUST override that result to
`blocked`, discard all returned resources, and include `detail.input` in the sorted `reads` set. If
the SDK returns `blocked` normally, its `input`, `source`, and `operation` MUST agree with the sticky
host detail or evaluation fails closed. The function may be absent in non-isolate SDK use; throwing
the typed `Blocked` signal remains the fallback behavior.

The SDK formats author errors as:

```text
error[HENOSIS_CODE]: what was wrong
  |
  = help: concrete repair
```

The host MUST preserve the code and message verbatim in diagnostics, adding component/bundle source
context outside rather than rewriting the inner message.

## 8. Determinism and content addressing

The SDK guards `Date.now()` and `Math.random()` in the in-process host. The Rust isolate must enforce
the stronger boundary: no `Date`, performance clock, timers, randomness, network, filesystem,
environment, locale-sensitive host data, or unpinned imports. The bundler MUST resolve and embed the
full module closure plus declared configuration files, then content-address the exact evaluation
closure. Workload executables and assets are built and addressed in the separate artifact lane.

Plan hashing SHOULD cover protocol version, bundle digest, canonical snapshot, static outputs,
observed bindings, resource addresses, and each resource canonical body. Diagnostic prose and stack
traces are not plan identity.

## 9. Host validation checklist

Before evaluation, Rust must verify:

1. protocol version and export shape;
2. unique, valid component/input/output names;
3. every output input source exists and schema types unify;
4. every config input has a graph binding or declared default, and every selected literal satisfies
   its config schema;
5. graph bindings name config inputs only, with all binding diagnostics aggregated;
6. `absent` is used only for optional output-sourced inputs;
7. available output values satisfy producer schemas and generation fencing.

After evaluation, Rust must verify:

1. result protocol/status shape and output-size limits;
2. sorted unique reads refer to declared inputs;
3. unique resource addresses and supported kind versions;
4. canonical body equivalence and controller-owned resource validation;
5. static output schemas and required/optional completeness;
6. observed bindings point to emitted resources and declared kind outputs;
7. blocked source agrees with the declaration for `blocked.input`.

Any discrepancy is a bundle/host protocol failure. Never reinterpret malformed data into a partial
plan.

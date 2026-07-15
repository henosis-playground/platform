import {
  executeComponent,
  type ComponentModule,
  type EvaluationResult,
  type EvaluationSnapshot,
  type HostBlockedDetail,
  type InputDeclarations,
  type InputSnapshotCell,
  type JsonValue,
  type OutputDeclarations,
} from "./sdk.js";

/** Pure in-process implementation of the Rust host's evaluation loop. */
export class FakeHost<
  Inputs extends InputDeclarations,
  Outputs extends OutputDeclarations,
> {
  private readonly cells = new Map<string, InputSnapshotCell>();

  constructor(readonly component: ComponentModule<Inputs, Outputs>) {}

  available(name: keyof Inputs & string, value: JsonValue): this {
    this.cells.set(name, { state: "available", value });
    return this;
  }

  blocked(name: keyof Inputs & string): this {
    this.cells.set(name, { state: "blocked" });
    return this;
  }

  absent(name: keyof Inputs & string): this {
    this.cells.set(name, { state: "absent" });
    return this;
  }

  run(): EvaluationResult {
    const snapshot: EvaluationSnapshot = {
      protocolVersion: 1,
      inputs: Object.freeze(Object.fromEntries(this.cells)),
    };
    let stickyBlocked: HostBlockedDetail | undefined;
    const hostGlobal = globalThis as typeof globalThis & {
      __henosis_mark_blocked?: (detail: HostBlockedDetail) => void;
    };
    const previousMarker = hostGlobal.__henosis_mark_blocked;
    hostGlobal.__henosis_mark_blocked = (detail) => {
      stickyBlocked ??= detail;
    };

    let result: EvaluationResult;
    try {
      result = executeComponent(this.component, snapshot);
    } finally {
      if (previousMarker === undefined) delete hostGlobal.__henosis_mark_blocked;
      else hostGlobal.__henosis_mark_blocked = previousMarker;
    }

    if (stickyBlocked === undefined) return result;
    if (result.status === "blocked") {
      if (
        result.blocked.input !== stickyBlocked.input
        || result.blocked.source !== stickyBlocked.source
        || result.blocked.operation !== stickyBlocked.operation
      ) {
        throw new Error("SDK blocked result disagrees with the sticky host blocked signal");
      }
      return result;
    }

    return Object.freeze({
      protocolVersion: 1 as const,
      status: "blocked" as const,
      resources: Object.freeze([]),
      blocked: Object.freeze({ code: "HENOSIS_BLOCKED" as const, ...stickyBlocked }),
      reads: Object.freeze([...new Set([...result.reads, stickyBlocked.input])].sort()),
    });
  }
}

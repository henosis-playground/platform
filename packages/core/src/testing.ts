import {
  executeComponent,
  type ComponentModule,
  type EvaluationResult,
  type EvaluationSnapshot,
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
    return executeComponent(this.component, snapshot);
  }
}

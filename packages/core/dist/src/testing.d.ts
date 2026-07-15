import { type ClosureFile, type ComponentModule, type EvaluationResult, type InputDeclarations, type JsonValue, type OutputDeclarations } from "./sdk.js";
/** Pure in-process implementation of the Rust host's evaluation loop. */
export declare class FakeHost<Inputs extends InputDeclarations, Outputs extends OutputDeclarations> {
    readonly component: ComponentModule<Inputs, Outputs>;
    private readonly closureFiles;
    private readonly cells;
    constructor(component: ComponentModule<Inputs, Outputs>, closureFiles?: readonly ClosureFile[]);
    available(name: keyof Inputs & string, value: JsonValue): this;
    blocked(name: keyof Inputs & string): this;
    absent(name: keyof Inputs & string): this;
    run(): EvaluationResult;
}
//# sourceMappingURL=testing.d.ts.map
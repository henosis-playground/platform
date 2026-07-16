import { type BundleInputSources, type ClosureFile, type ComponentModule, type ConfigDeclarations, type EvaluationResult, type JsonValue, type OutputDeclarations } from "./sdk.js";
/** Pure in-process implementation of the Rust host's evaluation loop. */
export declare class FakeHost<Config extends ConfigDeclarations, Outputs extends OutputDeclarations> {
    readonly component: ComponentModule<Config, Outputs>;
    private readonly closureFiles;
    private readonly derivedInputs;
    private readonly cells;
    constructor(component: ComponentModule<Config, Outputs>, closureFiles?: readonly ClosureFile[], derivedInputs?: BundleInputSources);
    available(name: string, value: JsonValue): this;
    blocked(name: string): this;
    absent(name: string): this;
    run(): EvaluationResult;
}
//# sourceMappingURL=testing.d.ts.map
import type { BuildValue, ComponentModule, DefineComponent, InferSchema, ObjectSchema, SchemaShape } from "@henosis/core";
import type { BuildContext, Env, StableEnvKind } from "./index.js";
/**
 * The temporary v1 component shape accepted only by platform-mock.
 *
 * @deprecated Migrate to `build(ctx)` or `build(ctx, params)` and read the
 * environment from `ctx.env`.
 */
export type V1CompatibilityComponentSpec<S extends ObjectSchema<SchemaShape>> = {
    readonly outputs: S;
    /**
     * If set, previews don't materialize this component. Any component that
     * depends on it in a preview environment is configured against the named
     * environment's instance of it.
     */
    readonly borrowForPreview?: StableEnvKind;
    /** The v1 compatibility shape never accepts a params table. */
    readonly params?: never;
    readonly build: (ctx: BuildContext, env: Env) => BuildValue<InferSchema<S>>;
};
/**
 * The mock platform's v2 definition function plus its temporary v1 overload.
 */
export interface PlatformMockDefineComponent extends DefineComponent<StableEnvKind, BuildContext> {
    /**
     * Defines a params-free component.
     *
     * V2 callbacks omit the second argument. It remains contextually typed here
     * only until the live v1 services migrate to `ctx.env`.
     */
    <Shape extends SchemaShape>(spec: V1CompatibilityComponentSpec<ObjectSchema<Shape>>): ComponentModule<ObjectSchema<Shape>>;
}
/** @internal Adapts the live v1 callback shape to the v2 platform lifecycle. */
export declare function withV1BuildCompatibility(defineV2: DefineComponent<StableEnvKind, BuildContext>): PlatformMockDefineComponent;
//# sourceMappingURL=v1-compat.d.ts.map
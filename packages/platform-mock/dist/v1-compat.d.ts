import type { BuildValue, ComponentModule, ComponentWithParamsSpec, InferSchema, ObjectSchema, PlatformDefineComponent, SchemaShape } from "@henosis/core";
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
     * Can preview traffic use the dev instance?
     *
     * In preview worlds this is honored only outside the changed reverse
     * dependency closure. When honored, artifacts are discarded.
    */
    readonly fallThrough?: boolean;
    /** The v1 compatibility shape never accepts a params table. */
    readonly params?: never;
    readonly build: (ctx: BuildContext, env: Env) => BuildValue<InferSchema<S>>;
};
/**
 * The mock platform's v2 definition function plus its temporary v1 overload.
 */
export interface PlatformMockDefineComponent {
    /** Defines a v2 component with an exhaustive environment params table. */
    <Shape extends SchemaShape, P>(spec: ComponentWithParamsSpec<ObjectSchema<Shape>, StableEnvKind, BuildContext, P>): ComponentModule<ObjectSchema<Shape>>;
    /**
     * Defines a params-free component.
     *
     * V2 callbacks omit the second argument. It remains contextually typed here
     * only until the live v1 services migrate to `ctx.env`.
     */
    <Shape extends SchemaShape>(spec: V1CompatibilityComponentSpec<ObjectSchema<Shape>>): ComponentModule<ObjectSchema<Shape>>;
}
/** @internal Adapts the live v1 callback shape to the v2 platform lifecycle. */
export declare function withV1BuildCompatibility(defineV2: PlatformDefineComponent<StableEnvKind, BuildContext>): PlatformMockDefineComponent;
//# sourceMappingURL=v1-compat.d.ts.map
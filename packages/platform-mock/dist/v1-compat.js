// LIVE-V1-COMPAT: current service-a/service-b still declare build(ctx, env).
// Delete this module and export platform.defineComponent directly once both
// services migrate to v2.
/** @internal Adapts the live v1 callback shape to the v2 platform lifecycle. */
export function withV1BuildCompatibility(defineV2) {
    const invokeV2 = defineV2;
    return ((spec) => {
        if (spec.params === undefined && spec.build.length >= 2) {
            const legacyBuild = spec.build;
            return invokeV2({
                outputs: spec.outputs,
                fallThrough: spec.fallThrough,
                build: ((ctx) => legacyBuild(ctx, ctx.env)),
            });
        }
        return invokeV2(spec);
    });
}
//# sourceMappingURL=v1-compat.js.map
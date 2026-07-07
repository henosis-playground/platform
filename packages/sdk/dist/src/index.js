import { createComponent } from "./types.js";
export * as conventions from "./conventions.js";
export { httpUrl, namespaceFor, postgresUrl, publicUrl, serviceHost, } from "./conventions.js";
export { executeBinding, executeBuild, materialiseBinding, materialiseToken, } from "./executor.js";
export { isBindingValueLike, isComponentLike } from "./types.js";
export function defineComponent(name, spec) {
    return createComponent(name, spec);
}
//# sourceMappingURL=index.js.map
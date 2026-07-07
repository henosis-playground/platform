const bindingValueBrand = Symbol("henosis.bindingValue");
const componentBrand = Symbol("henosis.component");
class BindingValueToken {
    convention;
    component;
    [bindingValueBrand] = true;
    constructor(convention, component) {
        this.convention = convention;
        this.component = component;
    }
}
class ComponentDefinition {
    name;
    spec;
    [componentBrand] = true;
    constructor(name, spec) {
        this.name = name;
        this.spec = spec;
    }
}
export function createBindingValue(convention, component) {
    return new BindingValueToken(convention, component);
}
export function isBindingValue(value) {
    return value instanceof BindingValueToken || isBindingValueLike(value);
}
export function isBindingValueLike(value) {
    return (isRecord(value) &&
        (value.convention === "httpUrl" ||
            value.convention === "publicUrl" ||
            value.convention === "host") &&
        (value.component === undefined || typeof value.component === "string"));
}
export function createComponent(name, spec) {
    return new ComponentDefinition(name, spec);
}
export function isComponentLike(value) {
    return (isRecord(value) &&
        typeof value.name === "string" &&
        isRecord(value.spec) &&
        typeof value.spec.binding === "function" &&
        typeof value.spec.build === "function");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=types.js.map
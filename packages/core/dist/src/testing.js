import { executeComponent, } from "./sdk.js";
/** Pure in-process implementation of the Rust host's evaluation loop. */
export class FakeHost {
    component;
    cells = new Map();
    constructor(component) {
        this.component = component;
    }
    available(name, value) {
        this.cells.set(name, { state: "available", value });
        return this;
    }
    blocked(name) {
        this.cells.set(name, { state: "blocked" });
        return this;
    }
    absent(name) {
        this.cells.set(name, { state: "absent" });
        return this;
    }
    run() {
        const snapshot = {
            protocolVersion: 1,
            inputs: Object.freeze(Object.fromEntries(this.cells)),
        };
        return executeComponent(this.component, snapshot);
    }
}
//# sourceMappingURL=testing.js.map
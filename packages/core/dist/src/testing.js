import { executeComponent, getComponentDefinition, } from "./sdk.js";
/** Pure in-process implementation of the Rust host's evaluation loop. */
export class FakeHost {
    component;
    closureFiles;
    cells = new Map();
    constructor(component, closureFiles = []) {
        this.component = component;
        this.closureFiles = closureFiles;
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
        const cells = new Map(this.cells);
        for (const [name, declaration] of Object.entries(getComponentDefinition(this.component).inputs)) {
            if (!cells.has(name) && declaration.kind === "config" && declaration.default !== undefined) {
                cells.set(name, { state: "available", value: declaration.default });
            }
        }
        const snapshot = {
            protocolVersion: 1,
            inputs: Object.freeze(Object.fromEntries(cells)),
        };
        let stickyBlocked;
        const hostGlobal = globalThis;
        const previousMarker = hostGlobal.__henosis_mark_blocked;
        hostGlobal.__henosis_mark_blocked = (detail) => {
            stickyBlocked ??= detail;
        };
        let result;
        try {
            result = executeComponent(this.component, snapshot, this.closureFiles);
        }
        finally {
            if (previousMarker === undefined)
                delete hostGlobal.__henosis_mark_blocked;
            else
                hostGlobal.__henosis_mark_blocked = previousMarker;
        }
        if (stickyBlocked === undefined)
            return result;
        if (result.status === "blocked") {
            if (result.blocked.input !== stickyBlocked.input
                || result.blocked.source !== stickyBlocked.source
                || result.blocked.operation !== stickyBlocked.operation) {
                throw new Error("SDK blocked result disagrees with the sticky host blocked signal");
            }
            return result;
        }
        return Object.freeze({
            protocolVersion: 1,
            status: "blocked",
            resources: Object.freeze([]),
            blocked: Object.freeze({ code: "HENOSIS_BLOCKED", ...stickyBlocked }),
            reads: Object.freeze([...new Set([...result.reads, stickyBlocked.input])].sort()),
        });
    }
}
//# sourceMappingURL=testing.js.map
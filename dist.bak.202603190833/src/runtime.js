let runtime = null;
export function setPinsonBotRuntime(next) {
    runtime = next;
}
export function getPinsonBotRuntime() {
    if (!runtime) {
        throw new Error("PinsonBot runtime not initialized");
    }
    return runtime;
}
//# sourceMappingURL=runtime.js.map
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setPinsonBotRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getPinsonBotRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("PinsonBot runtime not initialized");
  }
  return runtime;
}

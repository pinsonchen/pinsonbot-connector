/**
 * PinsonBot Connector - OpenClaw Channel Plugin Entry Point
 *
 * Registers the PinsonBot channel with the OpenClaw Gateway.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { pinsonbotPlugin } from "./src/channel.js";
import { setPinsonBotRuntime } from "./src/runtime.js";
import type { PinsonBotPluginModule } from "./src/types.js";

const plugin: PinsonBotPluginModule = {
  id: "pinsonbot",
  name: "PinsonBot Channel",
  description: "PinsonBots Platform WebSocket channel for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setPinsonBotRuntime(api.runtime);
    api.registerChannel({ plugin: pinsonbotPlugin });
  },
};

export default plugin;

/**
 * PinsonBot Connector - OpenClaw Channel Plugin Entry Point
 *
 * Registers the PinsonBot channel with the OpenClaw Gateway.
 */
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { pinsonbotPlugin } from "./src/channel.js";
import { setPinsonBotRuntime } from "./src/runtime.js";
const plugin = {
    id: "pinsonbot",
    name: "PinsonBot Channel",
    description: "PinsonBots Platform WebSocket channel for OpenClaw",
    configSchema: emptyPluginConfigSchema(),
    register(api) {
        setPinsonBotRuntime(api.runtime);
        api.registerChannel({ plugin: pinsonbotPlugin });
    },
};
export default plugin;
//# sourceMappingURL=index.js.map
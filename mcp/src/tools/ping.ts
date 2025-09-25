import type { Tool } from "../types/tool.js";

export const ping: Tool = {
    name: "ping",
    description: "Simple health check tool that echoes back input.",
    inputSchema: {
        type: "object",
        properties: {
            message: { type: "string", description: "Message to echo back" }
        },
        required: ["message"]
    },
    handler: async (args: any) => {
        const message = String(args?.message ?? "");
        return {
            content: [
                { type: "text", text: `pong: ${message}` }
            ]
        };
    }
};

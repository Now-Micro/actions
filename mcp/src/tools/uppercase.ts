import type { Tool } from "../types/tool.js";

export const uppercase: Tool = {
    name: "uppercase",
    description: "Uppercases the provided message and returns it.",
    inputSchema: {
        type: "object",
        properties: {
            message: { type: "string", description: "Message to uppercase" }
        },
        required: ["message"]
    },
    handler: async (args: any) => {
        const message = String(args?.message ?? "");
        return {
            content: [
                { type: "text", text: message.toUpperCase() }
            ]
        };
    }
};

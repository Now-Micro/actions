import type { Tool } from "../types/tool.js";

export const uppercase: Tool = {
    name: "uppercase",
    description: "Convert text to UPPERCASE. Use when the user asks to 'uppercase', 'make caps', 'all caps', 'shout', or 'screaming case'.",
    inputSchema: {
        type: "object",
        properties: {
            message: { type: "string", description: "Message to uppercase (alias of 'text')" },
            text: { type: "string", description: "Text to convert to UPPERCASE" }
        },
        // Allow either 'text' or 'message' for more natural prompts
        required: []
    },
    handler: async (args: any) => {
        const raw = args?.text ?? args?.message ?? "";
        const message = String(raw);
        return {
            content: [
                { type: "text", text: message.toUpperCase() }
            ]
        };
    }
};

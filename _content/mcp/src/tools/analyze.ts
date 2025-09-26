import type { Tool } from "../types/tool.js";

export const analyze: Tool = {
    name: "analyze",
    description: "Return length and uppercase version of text.",
    inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "Text to analyze" } },
        required: ["text"]
    },
    handler: async (args: any) => {
        const text = String(args?.text ?? "");
        const upper = text.toUpperCase();
        const length = text.length;
        return {
            content: [{ type: "text", text: `len=${length}; upper=${upper}` }],
            structuredContent: { length, upper }
        };
    }
};

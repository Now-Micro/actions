import type { Tool } from "../types/tool.js";

export const fail: Tool = {
    name: "fail",
    description: "Always returns an error with the provided reason (if any).",
    inputSchema: {
        type: "object",
        properties: {
            reason: { type: "string", description: "Optional failure reason" }
        },
        required: []
    },
    handler: async (args: any) => {
        const reason = args && typeof args.reason === 'string' ? args.reason : '';
        const msg = reason ? `error: ${reason}` : `error`;
        return {
            content: [{ type: "text", text: msg }],
            isError: true
        };
    }
};

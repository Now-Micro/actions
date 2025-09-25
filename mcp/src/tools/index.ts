import type { Tool } from "../types/tool.js";
import { z } from "zod";
import { ping } from "./ping.js";

type McpLikeServer = {
    tool: (...args: any[]) => any;
    registerTool?: (name: string, config: any, cb: (args: any, extra?: any) => Promise<any>) => any;
};

export function registerTools(server: McpLikeServer) {
    const tools: Tool[] = [ping];
    for (const t of tools) {
        const cb = async (maybeArgs: any, extra?: any) => {
            // Normalize to args regardless of server calling convention
            if (maybeArgs && typeof maybeArgs === 'object' && 'message' in maybeArgs) {
                return t.handler(maybeArgs);
            }
            const ex = extra ?? {};
            const fromRequest = ex && ex.request && ex.request.params && ex.request.params.arguments ? ex.request.params.arguments : undefined;
            return t.handler(fromRequest ?? {});
        };
        if (typeof server.registerTool === 'function') {
            // Provide raw shape; SDK wraps with z.object internally
            const inputSchema = { message: z.string() };
            server.registerTool(t.name, { description: t.description, inputSchema }, cb);
        } else {
            server.tool(t.name, cb);
        }
    }
}

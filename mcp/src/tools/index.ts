import type { Tool } from "../types/tool.js";
import { z } from "zod";
import { ping } from "./ping.js";
import { uppercase } from "./uppercase.js";
import { analyze } from "./analyze.js";

type McpLikeServer = {
    tool: (...args: any[]) => any;
    registerTool?: (name: string, config: any, cb: (args: any, extra?: any) => Promise<any>) => any;
};

export function registerTools(server: McpLikeServer) {
    const tools: Tool[] = [ping, uppercase, analyze];
    for (const t of tools) {
        const cb = async (maybeArgs: any, extra?: any) => {
            // Normalize to args regardless of server calling convention
            if (maybeArgs && typeof maybeArgs === 'object' && Object.keys(maybeArgs).length > 0) {
                return t.handler(maybeArgs);
            }
            const ex = extra ?? {};
            const fromRequest = ex && ex.request && ex.request.params && ex.request.params.arguments ? ex.request.params.arguments : undefined;
            return t.handler(fromRequest ?? {});
        };
        if (typeof server.registerTool === 'function') {
            // Provide raw shapes; SDK wraps with z.object internally
            const common = { description: t.description } as any;
            if (t.name === 'ping') {
                common.inputSchema = { message: z.string() };
            } else if (t.name === 'uppercase') {
                common.inputSchema = { message: z.string() };
            } else if (t.name === 'analyze') {
                common.inputSchema = { text: z.string() };
                common.outputSchema = { length: z.number(), upper: z.string() };
            }
            server.registerTool(t.name, common, cb);
        } else {
            server.tool(t.name, cb);
        }
    }
}

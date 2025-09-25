import type { Tool } from "../types/tool.js";
import { z } from "zod";
import { ping } from "./ping.js";
import { uppercase } from "./uppercase.js";
import { analyze } from "./analyze.js";
import { fail } from "./fail.js";

type McpLikeServer = {
    tool: (...args: any[]) => any;
    registerTool?: (name: string, config: any, cb: (args: any, extra?: any) => Promise<any>) => any;
};

export function registerTools(server: McpLikeServer) {
    const tools: Tool[] = [ping, uppercase, analyze, fail];
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
                // Accept both 'text' and 'message' to help NL planners
                common.inputSchema = { message: z.string().optional(), text: z.string().optional() };
            } else if (t.name === 'analyze') {
                // Accept 'text' primarily, but allow 'message' synonym
                common.inputSchema = { text: z.string().optional(), message: z.string().optional() };
                common.outputSchema = { length: z.number(), upper: z.string() };
            } else if (t.name === 'fail') {
                common.inputSchema = { reason: z.string().optional() };
            }
            server.registerTool(t.name, common, cb);
            // Register a couple of helpful aliases for natural phrasing
            if (t.name === 'uppercase') {
                server.registerTool('caps', common, cb);
                server.registerTool('all-caps', common, cb);
            }
            if (t.name === 'analyze') {
                server.registerTool('analyze-text', common, cb);
            }
        } else {
            server.tool(t.name, cb);
            if (t.name === 'uppercase') {
                server.tool('caps', cb);
                server.tool('all-caps', cb);
            }
            if (t.name === 'analyze') {
                server.tool('analyze-text', cb);
            }
        }
    }
}

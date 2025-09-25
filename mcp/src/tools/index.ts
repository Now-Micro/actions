import type { Tool, ToolRegistrar } from "../types/tool.js";
import { ping } from "./ping.js";

export function registerTools(server: ToolRegistrar) {
    const tools: Tool[] = [ping];
    for (const t of tools) server.tool(t);
}

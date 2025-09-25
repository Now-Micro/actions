import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

async function main() {
    const server = new McpServer({
        name: "now-micro-actions-mcp-server",
        version: "0.1.0",
    });

    // Register tools from src/tools
    registerTools(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    // Keep logs concise and safe for terminals
    console.error("Server error:", err?.message || err);
    process.exit(1);
});

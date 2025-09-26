// Ambient module declarations to satisfy the TypeScript compiler
// until actual dependencies are installed. These are intentionally minimal.
declare module "@modelcontextprotocol/sdk/server/mcp.js" {
    export class McpServer {
        constructor(info: { name: string; version: string });
        tool(t: any): void;
        connect(transport: any): Promise<void>;
    }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
    export class StdioServerTransport {
        constructor();
    }
}

// Minimal NodeJS global shim (only what's needed here)
declare const process: {
    exit(code?: number): never;
    cwd(): string;
    env: Record<string, string | undefined>;
};

declare module 'yaml' {
    const mod: any;
    export default mod;
}

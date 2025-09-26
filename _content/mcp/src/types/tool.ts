// Minimal Tool type compatible with MCP SDK's concept, to keep this repo self-contained
export type TextContent = { type: "text"; text: string };

export type Tool = {
    name: string;
    description?: string;
    inputSchema?: any;
    handler: (args: any) => Promise<{ content: TextContent[]; structuredContent?: any; isError?: boolean }>;
};

export type ToolRegistrar = {
    tool: (t: Tool) => void;
};

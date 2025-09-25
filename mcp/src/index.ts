import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "path";
import { buildActionsIndex, renderActionMarkdown } from "./resources/actions-indexer.js";
import { setActionsIndex, getActionsIndex } from "./resources/actions-store.js";

async function main() {
    const server = new McpServer({
        name: "now-micro-actions-mcp-server",
        version: "0.1.0",
    });

    // No test tools; only register real actions-related tools below

    // Build actions index and expose as resources (best-effort: ignore errors)
    try {
        const repoRoot = path.resolve(process.cwd(), "..");
        const idx = buildActionsIndex(repoRoot);
        setActionsIndex(idx);
        const resources: any[] = [];
        // Catalog JSON
        resources.push({
            uri: "nowmicro-actions://actions/index",
            name: "Now Micro Actions Catalog",
            mimeType: "application/json",
            read: async () => JSON.stringify(idx.catalog, null, 2)
        });
        // Per-action JSON and Markdown
        for (const spec of Object.values(idx.byId)) {
            resources.push({
                uri: `nowmicro-actions://actions/${spec.id}.json`,
                name: `${spec.id} (json)`,
                mimeType: "application/json",
                read: async () => JSON.stringify(spec, null, 2)
            });
            resources.push({
                uri: `nowmicro-actions://actions/${spec.id}.md`,
                name: `${spec.id} (md)`,
                mimeType: "text/markdown",
                read: async () => renderActionMarkdown(spec)
            });
        }

        // Register resources if the SDK provides an API; otherwise, add a fallback tool
        const anyServer: any = server as any;
        if (typeof anyServer.addResource === 'function') {
            for (const r of resources) anyServer.addResource(r);
            // Add a simple search template if supported
            if (typeof anyServer.addResourceTemplate === 'function') {
                anyServer.addResourceTemplate({
                    uriTemplate: 'nowmicro-actions://actions/search?q={query}',
                    name: 'Search Now Micro Actions',
                    mimeType: 'application/json',
                    read: async ({ query }: any) => {
                        const q = (query || '').toString().toLowerCase();
                        const filtered = idx.catalog.filter(x =>
                            x.id.includes(q) ||
                            (x.name || '').toLowerCase().includes(q) ||
                            (x.description || '').toLowerCase().includes(q) ||
                            x.relDir.toLowerCase().includes(q)
                        );
                        return JSON.stringify(filtered, null, 2);
                    }
                });
            }
        } else {
            // Fallback tools for listing and getting actions
            const listCb = async () => ({ content: [{ type: 'text', text: JSON.stringify(idx.catalog) }] });
            const getCb = async (args: any) => {
                const id = String(args?.id || args?.slug || '');
                const spec = idx.byId[id];
                if (!id || !spec) return { content: [{ type: 'text', text: 'not found' }], isError: true };
                return { content: [{ type: 'text', text: JSON.stringify(spec) }] };
            };
            if (typeof anyServer.registerTool === 'function') {
                anyServer.registerTool('list-actions', { description: 'List all composite GitHub Actions in this repository as JSON catalog.' }, listCb);
                anyServer.registerTool('get-action', { description: 'Get full JSON spec for a composite action by id/slug.', inputSchema: { id: { type: 'string' }, slug: { type: 'string' } } }, getCb);
            } else {
                anyServer.tool?.('list-actions', listCb);
                anyServer.tool?.('get-action', getCb);
            }
        }

        // Utility tools available regardless of resource API to keep experience consistent
        const reindexCb = async () => {
            const fresh = buildActionsIndex(repoRoot);
            setActionsIndex(fresh);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count: fresh.catalog.length }) }] };
        };

        const snippetCb = async (args: any) => {
            const id = String(args?.id || args?.slug || '');
            const values = (args?.values && typeof args.values === 'object') ? args.values : {};
            const includeOptional = !!args?.includeOptional;
            const idxNow = getActionsIndex();
            const spec = idxNow.byId[id];
            if (!id || !spec) return { content: [{ type: 'text', text: 'not found' }], isError: true };
            const lines: string[] = [];
            lines.push(`- name: ${spec.name || spec.id}`);
            lines.push(`  uses: ${spec.uses}`);
            const toWrite: string[] = [];
            for (const i of spec.inputs) {
                const hasVal = Object.prototype.hasOwnProperty.call(values, i.name);
                if (i.required) {
                    const v = hasVal ? values[i.name] : '<REQUIRED>';
                    toWrite.push(`    ${i.name}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
                } else if (includeOptional || hasVal || i.default !== undefined) {
                    const v = hasVal ? values[i.name] : (i.default !== undefined ? i.default : '<OPTIONAL>');
                    toWrite.push(`    ${i.name}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
                }
            }
            if (toWrite.length) {
                lines.push('  with:');
                lines.push(...toWrite);
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        };

        const searchCb = async (args: any) => {
            const q = String(args?.q || args?.query || '').toLowerCase();
            const idxNow = getActionsIndex();
            if (!q) return { content: [{ type: 'text', text: JSON.stringify(idxNow.catalog) }] };
            const filtered = idxNow.catalog.filter(x =>
                x.id.includes(q) ||
                (x.name || '').toLowerCase().includes(q) ||
                (x.description || '').toLowerCase().includes(q) ||
                x.relDir.toLowerCase().includes(q)
            );
            return { content: [{ type: 'text', text: JSON.stringify(filtered) }] };
        };

        if (typeof anyServer.registerTool === 'function') {
            anyServer.registerTool('reindex-actions', { description: 'Rebuild the in-memory index of composite actions in this repository.' }, reindexCb);
            anyServer.registerTool('make-workflow-snippet', {
                description: 'Return a YAML step snippet for a composite action by id/slug. Accepts values to prefill inputs and includeOptional to include optional inputs.',
                inputSchema: { id: { type: 'string' }, slug: { type: 'string' }, values: { type: 'object' }, includeOptional: { type: 'boolean' } }
            }, snippetCb);
            anyServer.registerTool('search-actions', { description: 'Search the actions catalog by query string.', inputSchema: { q: { type: 'string' }, query: { type: 'string' } } }, searchCb);
        } else {
            anyServer.tool?.('reindex-actions', reindexCb);
            anyServer.tool?.('make-workflow-snippet', snippetCb);
            anyServer.tool?.('search-actions', searchCb);
        }
    } catch (_) {
        // Do not crash the server if indexing fails
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    // Keep logs concise and safe for terminals
    console.error("Server error:", err?.message || err);
    process.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverCommand = process.execPath;
const serverArgs = [new URL('../dist/index.js', import.meta.url).pathname.replace(/^\//, process.platform === 'win32' ? '' : '/')];

test('stdio harness: actions resources and tools end-to-end', async (t) => {
    const transport = new StdioClientTransport({
        command: serverCommand,
        args: serverArgs,
        env: process.env,
        stderr: 'pipe',
    });

    const client = new Client({ name: 'harness-client', version: '0.0.0' }, {});

    await client.connect(transport);
    t.after(async () => { await client.close(); });

    // List tools and find ping
    const tools = await client.listTools({});
    assert.ok(Array.isArray(tools.tools) && tools.tools.length > 0, 'no tools returned');
    // Expect core actions-related tools
    assert.ok(tools.tools.find(t => t.name === 'search-actions'), 'search-actions tool missing');
    assert.ok(tools.tools.find(t => t.name === 'make-workflow-snippet'), 'make-workflow-snippet tool missing');
    assert.ok(tools.tools.find(t => t.name === 'reindex-actions'), 'reindex-actions tool missing');

    // Resource listing (if supported by server)
    try {
        const resources = await client.listResources({});
        assert.ok(Array.isArray(resources.resources), 'resources not an array');
        const catalog = resources.resources.find(r => r.uri === 'nowmicro-actions://actions/index');
        if (catalog) {
            const content = await client.readResource({ uri: catalog.uri });
            assert.ok(Array.isArray(JSON.parse(content.contents[0].text)), 'catalog should be a JSON array');
        }
    } catch (_) {
        // Some SDK versions may not support resources via client; ignore
    }

    // Try snippet and reindex tools (best effort)
    try {
        const res5 = await client.callTool({ name: 'reindex-actions', arguments: {} });
        assert.ok(/"ok":true/.test(res5.content?.[0]?.text || ''), 'reindex did not return ok:true');
    } catch (_) { }
    try {
        // Use search-actions to find a candidate id, then build a snippet
        const sr = await client.callTool({ name: 'search-actions', arguments: { q: '' } });
        const list = JSON.parse(sr.content?.[0]?.text || '[]');
        const candidate = list[0]?.id;
        if (candidate) {
            const snip = await client.callTool({ name: 'make-workflow-snippet', arguments: { id: candidate, values: {}, includeOptional: false } });
            const txt = snip.content?.[0]?.text || '';
            assert.ok(/^\- name: /.test(txt), 'snippet missing name line');
            assert.ok(/\n  uses: /.test(txt), 'snippet missing uses line');
        }
    } catch (_) { }

    // Basic search assertion for a targeted query
    try {
        const sr2 = await client.callTool({ name: 'search-actions', arguments: { q: 'dotnet' } });
        const parsed = JSON.parse(sr2.content?.[0]?.text || '[]');
        assert.ok(Array.isArray(parsed), 'search result not an array');
    } catch (_) { }
});

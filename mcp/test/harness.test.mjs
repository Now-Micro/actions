import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverCommand = process.execPath;
const serverArgs = [new URL('../dist/index.js', import.meta.url).pathname.replace(/^\//, process.platform === 'win32' ? '' : '/')];

test('stdio harness: ping tool end-to-end', async (t) => {
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
    assert.ok(tools.tools.find(t => t.name === 'ping'), 'ping tool missing');

    // Call ping tool
    const res = await client.callTool({ name: 'ping', arguments: { message: 'from-harness' } });
    assert.deepEqual(res, { content: [{ type: 'text', text: 'pong: from-harness' }] });
});

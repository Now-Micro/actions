import test from 'node:test';
import assert from 'node:assert/strict';

// Import compiled outputs after build
import { registerTools } from '../dist/tools/index.js';

class FakeServer {
    constructor() { this.tools = []; }
    tool(t) { this.tools.push(t); }
}

// Smoke test: tools register and ping echoes input

test('tools register and ping works', async () => {
    const server = new FakeServer();
    registerTools(server);
    assert.ok(server.tools.length > 0, 'no tools registered');

    const ping = server.tools.find(t => t.name === 'ping');
    assert.ok(ping, 'ping tool not found');

    const result = await ping.handler({ message: 'hello' });
    assert.deepEqual(result, { content: [{ type: 'text', text: 'pong: hello' }] });
});

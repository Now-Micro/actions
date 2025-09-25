import test from 'node:test';
import assert from 'node:assert/strict';

// Import compiled outputs after build
import { registerTools } from '../dist/tools/index.js';

class FakeServer {
    constructor() { this.tools = []; }
    // Fallback signature used by our registerTools when registerTool is absent
    tool(name, cb) {
        if (typeof name === 'string' && typeof cb === 'function') {
            this.tools.push({ name, handler: (args) => cb(args) });
        } else if (name && typeof name === 'object') {
            this.tools.push(name);
        }
    }
    // Preferred path used by registerTools
    registerTool(name, _config, cb) {
        this.tools.push({ name, handler: (args) => cb(args) });
    }
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

    const upper = server.tools.find(t => t.name === 'uppercase');
    assert.ok(upper, 'uppercase tool not found');
    const ures = await upper.handler({ message: 'Hello, World!' });
    assert.deepEqual(ures, { content: [{ type: 'text', text: 'HELLO, WORLD!' }] });

    const analyze = server.tools.find(t => t.name === 'analyze');
    assert.ok(analyze, 'analyze tool not found');
    const ares = await analyze.handler({ text: 'Abc' });
    assert.deepEqual(ares, {
        content: [{ type: 'text', text: 'len=3; upper=ABC' }],
        structuredContent: { length: 3, upper: 'ABC' }
    });
});

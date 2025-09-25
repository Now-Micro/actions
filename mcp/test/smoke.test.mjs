import test from 'node:test';
import assert from 'node:assert/strict';

// Import compiled outputs after build
import { registerTools } from '../dist/tools/index.js';

class FakeServer {
    constructor() { this.tools = []; }
    tool(name, cb) {
        if (typeof name === 'string' && typeof cb === 'function') {
            this.tools.push({ name, handler: (args) => cb(args) });
        } else if (name && typeof name === 'object') {
            this.tools.push(name);
        }
    }
    registerTool(name, _config, cb) {
        this.tools.push({ name, handler: (args) => cb(args) });
    }
}

// Smoke test: legacy test tools have been removed; registerTools is a no-op
test('registerTools registers no legacy test tools', async () => {
    const server = new FakeServer();
    registerTools(server);
    assert.equal(server.tools.length, 0, 'expected no tools to be registered by registerTools');
});

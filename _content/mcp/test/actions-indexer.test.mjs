import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildActionsIndex, renderActionMarkdown, normalizeSpec, slugFromRelDir } from '../dist/resources/actions-indexer.js';

function mkTmp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-actions-'));
    return dir;
}

test('slugFromRelDir converts path to slug', () => {
    assert.equal(slugFromRelDir('dotnet/build'), 'dotnet-build');
});

test('indexer finds action.yml and normalizes', () => {
    const tmp = mkTmp();
    const aDir = path.join(tmp, 'dotnet', 'build');
    fs.mkdirSync(aDir, { recursive: true });
    fs.writeFileSync(path.join(aDir, 'action.yml'), `name: Dotnet Build\ndescription: Build .NET project\ninputs:\n  project:\n    description: csproj path\n    required: true\n  configuration:\n    default: Release\n`);
    const idx = buildActionsIndex(tmp);
    assert.ok(idx.catalog.length >= 1);
    const item = idx.catalog.find(c => c.relDir === 'dotnet/build');
    assert.ok(item);
    const spec = idx.byId[item.id];
    assert.equal(spec.relDir, 'dotnet/build');
    assert.equal(spec.uses, 'Now-Micro/actions/dotnet/build@main');
    const md = renderActionMarkdown(spec);
    assert.ok(/## Usage/.test(md));
});

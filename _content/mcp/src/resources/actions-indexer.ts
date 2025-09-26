import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export type ActionInput = {
    name: string;
    required?: boolean;
    default?: any;
    description?: string;
    type?: string;
    options?: any[];
};

export type ActionOutput = {
    name: string;
    description?: string;
};

export type ActionSpec = {
    id: string; // slug
    name?: string;
    description?: string;
    relDir: string; // e.g., 'dotnet/build'
    actionFile: string; // e.g., 'dotnet/build/action.yml'
    uses: string; // e.g., 'Now-Micro/actions/dotnet/build@main'
    branding?: { color?: string; icon?: string };
    inputs: ActionInput[];
    outputs: ActionOutput[];
    examples: { title: string; yaml: string }[];
};

export type ActionsCatalogItem = {
    id: string;
    name?: string;
    description?: string;
    relDir: string;
    uses: string;
    inputsSummary: string;
    outputsSummary: string;
};

export type ActionsIndex = {
    catalog: ActionsCatalogItem[];
    byId: Record<string, ActionSpec>;
};

const IGNORES = new Set(['.git', 'node_modules', 'dist', '.vscode', 'mcp/dist']);

export function slugFromRelDir(relDir: string): string {
    return relDir.replace(/\\/g, '/').replace(/\//g, '-');
}

function walkDirs(root: string, acc: string[] = [], base: string = root): string[] {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        if (IGNORES.has(e.name)) continue;
        const full = path.join(root, e.name);
        if (e.isDirectory()) {
            const actionYml = path.join(full, 'action.yml');
            if (fs.existsSync(actionYml)) acc.push(path.relative(base, actionYml));
            walkDirs(full, acc, base);
        }
    }
    return acc;
}

export function parseActionYaml(filePath: string): any {
    const raw = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(raw);
}

export function normalizeSpec(repoRoot: string, actionFileRel: string): ActionSpec | null {
    try {
        const fileAbs = path.join(repoRoot, actionFileRel);
        const y = parseActionYaml(fileAbs) || {};
        const relDir = path.dirname(actionFileRel).replace(/\\/g, '/');
        const id = slugFromRelDir(relDir);
        const uses = `Now-Micro/actions/${relDir}@main`;
        const inputs: ActionInput[] = [];
        const outputs: ActionOutput[] = [];
        const inObj = y.inputs || {};
        for (const k of Object.keys(inObj)) {
            const v = inObj[k] || {};
            const input: ActionInput = {
                name: k,
                required: !!v.required,
                default: v.default,
                description: v.description,
            };
            if (v.type) input.type = v.type;
            if (Array.isArray(v.options)) input.options = v.options;
            inputs.push(input);
        }
        const outObj = y.outputs || {};
        for (const k of Object.keys(outObj)) {
            const v = outObj[k] || {};
            outputs.push({ name: k, description: v.description });
        }
        const snippetLines: string[] = [
            `- name: ${y.name || id}`,
            `  uses: ${uses}`,
        ];
        if (inputs.some(i => i.required || i.default !== undefined)) {
            snippetLines.push('  with:');
            for (const i of inputs) {
                if (i.required) snippetLines.push(`    ${i.name}: <REQUIRED>`);
                else if (i.default !== undefined) snippetLines.push(`    ${i.name}: ${JSON.stringify(i.default)}`);
            }
        }
        const examples = [{ title: 'Basic usage', yaml: snippetLines.join('\n') }];
        return {
            id,
            name: y.name,
            description: y.description,
            relDir,
            actionFile: actionFileRel.replace(/\\/g, '/'),
            uses,
            branding: y.branding,
            inputs,
            outputs,
            examples,
        };
    } catch (e) {
        return null;
    }
}

export function buildActionsIndex(repoRoot: string): ActionsIndex {
    const actionFiles = walkDirs(repoRoot);
    const byId: Record<string, ActionSpec> = {};
    const catalog: ActionsCatalogItem[] = [];
    for (const rel of actionFiles) {
        const spec = normalizeSpec(repoRoot, rel);
        if (!spec) continue;
        byId[spec.id] = spec;
        const inputsSummary = spec.inputs.length ? spec.inputs.map(i => `${i.name}${i.required ? '*' : ''}`).join(', ') : '—';
        const outputsSummary = spec.outputs.length ? spec.outputs.map(o => o.name).join(', ') : '—';
        catalog.push({
            id: spec.id,
            name: spec.name,
            description: spec.description,
            relDir: spec.relDir,
            uses: spec.uses,
            inputsSummary,
            outputsSummary,
        });
    }
    // Keep stable order: sort by relDir
    catalog.sort((a, b) => a.relDir.localeCompare(b.relDir));
    return { catalog, byId };
}

export function renderActionMarkdown(spec: ActionSpec): string {
    const lines: string[] = [];
    lines.push(`# ${spec.name || spec.id}`);
    if (spec.description) lines.push(`\n${spec.description}`);
    lines.push(`\n## Usage`);
    const ex = spec.examples[0];
    lines.push('```yaml');
    lines.push(ex.yaml);
    lines.push('```');
    if (spec.inputs.length) {
        lines.push(`\n## Inputs`);
        for (const i of spec.inputs) {
            const req = i.required ? ' (required)' : '';
            const def = i.default !== undefined ? ` (default: ${JSON.stringify(i.default)})` : '';
            lines.push(`- ${i.name}${req}${def}${i.description ? ` — ${i.description}` : ''}`);
        }
    }
    if (spec.outputs.length) {
        lines.push(`\n## Outputs`);
        for (const o of spec.outputs) {
            lines.push(`- ${o.name}${o.description ? ` — ${o.description}` : ''}`);
        }
    }
    lines.push(`\nPath: ${spec.actionFile}`);
    return lines.join('\n');
}

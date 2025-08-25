#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function log(msg) {
    process.stdout.write(String(msg) + '\n');
}

function stripComments(xml) {
    return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function removeEnforceCodeStyle(xml) {
    // Remove all EnforceCodeStyleInBuild elements (any value)
    return xml.replace(/<EnforceCodeStyleInBuild>[\s\S]*?<\/EnforceCodeStyleInBuild>/gi, '');
}

function removeAnalyzerProjectReferences(xml) {
    let updated = xml;
    // Remove self-closing ProjectReference with Analyzer attribute
    updated = updated.replace(/<ProjectReference\b[^>]*?OutputItemType="Analyzer"[^>]*?\/>/gi, '');
    // Remove paired ProjectReference with Analyzer attribute
    updated = updated.replace(/<ProjectReference\b[^>]*?OutputItemType="Analyzer"[^>]*?>[\s\S]*?<\/ProjectReference>/gi, '');
    // Remove now-empty ItemGroups
    updated = updated.replace(/<ItemGroup>\s*<\/ItemGroup>/gi, '');
    return updated;
}

function ensureEnforceCodeStyleTrue(xml) {
    let updated = xml;
    let changed = false;
    const re = /<EnforceCodeStyleInBuild>([\s\S]*?)<\/EnforceCodeStyleInBuild>/i;
    const m = re.exec(updated);
    if (m) {
        const current = (m[1] || '').trim().toLowerCase();
        if (current !== 'true') {
            updated = updated.replace(re, '<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>');
            changed = true;
            log('Updated EnforceCodeStyleInBuild to true');
        }
        return { updated, changed };
    }
    // Not present: insert into first <PropertyGroup>
    const pgOpen = /<PropertyGroup\b[^>]*>/i;
    const mo = pgOpen.exec(updated);
    if (mo) {
        const startIdx = mo.index + mo[0].length;
        const closeIdx = updated.indexOf('</PropertyGroup>', startIdx);
        if (closeIdx !== -1) {
            const indentMatch = /(\r?\n)([ \t]*)<\/PropertyGroup>/.exec(updated.slice(startIdx - 200, closeIdx + 16)) || [];
            const nl = '\n';
            const indent = (indentMatch[2] || '  ');
            const insertion = `${nl}${indent}  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>`;
            updated = updated.slice(0, closeIdx) + insertion + updated.slice(closeIdx);
            changed = true;
            log('Inserted EnforceCodeStyleInBuild into first PropertyGroup');
            return { updated, changed };
        }
    }
    // No PropertyGroup found: create one before </Project> or append
    const closing = '</Project>';
    const idx = updated.lastIndexOf(closing);
    const block = `  <PropertyGroup>\n    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>\n  </PropertyGroup>\n`;
    if (idx >= 0) {
        updated = updated.slice(0, idx) + block + updated.slice(idx);
    } else {
        if (!updated.endsWith('\n')) updated += '\n';
        updated += block;
    }
    changed = true;
    log('Added PropertyGroup with EnforceCodeStyleInBuild');
    return { updated, changed };
}

function run() {
    console.log(`Injecting Analyzer ProjectReference...`);
    const projectFile = (process.env.INPUT_PROJECT_FILE || '').trim();
    const includePath = (process.env.INPUT_INCLUDE_PATH || '').trim();

    console.log(`projectFile: ${projectFile}`);
    console.log(`includePath: ${includePath}`);
    if (!projectFile || !fs.existsSync(projectFile)) {
        log(`No project file found at '${projectFile}'; skipping update of project file`);
        process.exit(1);
    }
    if (!includePath) {
        log(`No include path provided; skipping update of ${projectFile}`);
        process.exit(1);
    }

    const original = fs.readFileSync(projectFile, 'utf8');
    // Step 1: remove comments and existing entries
    let updated = stripComments(original);
    updated = removeEnforceCodeStyle(updated);
    updated = removeAnalyzerProjectReferences(updated);

    let anyChange = false;

    // Step 2: insert the current desired entries
    const enforced = ensureEnforceCodeStyleTrue(updated);
    updated = enforced.updated;
    anyChange = anyChange || enforced.changed;

    const injection = [
        '  <ItemGroup>',
        '    <ProjectReference',
        `      Include="${includePath}"`,
        '      OutputItemType="Analyzer"',
        '      ReferenceOutputAssembly="false"',
        '    />',
        '  </ItemGroup>',
        ''
    ].join('\n');

    const closing = '</Project>';
    const idx = updated.lastIndexOf(closing);
    if (idx >= 0) {
        updated = updated.slice(0, idx) + injection + updated.slice(idx);
    } else {
        if (!updated.endsWith('\n')) updated += '\n';
        updated += injection;
    }
    anyChange = true;
    log('Inserted Analyzer ProjectReference into project');

    if (anyChange) {
        fs.writeFileSync(projectFile, updated, 'utf8');
    }
}

if (require.main === module) {
    try { run(); } catch (e) { console.error(e?.message || String(e)); process.exit(1); }
}

module.exports = { run, ensureEnforceCodeStyleTrue };

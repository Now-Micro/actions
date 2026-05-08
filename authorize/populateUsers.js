const fs = require('fs');
const readline = require('node:readline/promises');
const path = require('path');

const DEFAULT_ORG = 'Now-Micro';
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'users.json');
const GITHUB_API_BASE = 'https://api.github.com';

function parseArgs(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--token' || arg === '--github-token') {
			result.token = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (arg === '--org') {
			result.org = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (arg === '--output-file') {
			result.outputFile = argv[index + 1] || '';
			index += 1;
			continue;
		}
	}
	return result;
}

function normalizeWhitespace(value) {
	return String(value).trim().replace(/\s+/g, ' ');
}

function uniqueCaseInsensitive(values) {
	const seen = new Set();
	const result = [];
	for (const value of values) {
		const trimmed = normalizeWhitespace(value);
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function loadExistingUsers(filePath) {
	if (!fs.existsSync(filePath)) {
		return {};
	}

	const raw = fs.readFileSync(filePath, 'utf8');
	if (!raw.trim()) {
		return {};
	}

	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`Expected ${filePath} to contain a JSON object.`);
	}

	const normalized = {};
	for (const [login, value] of Object.entries(parsed)) {
		normalized[normalizeWhitespace(login)] = Array.isArray(value)
			? normalizeWhitespace(value.find(item => normalizeWhitespace(item)) || '')
			: normalizeWhitespace(value);
	}

	return normalized;
}

function findExistingNameForLogin(existingUsers, login) {
	const lowerLogin = login.toLowerCase();
	const found = Object.keys(existingUsers).find(key => {
		const value = existingUsers[key];
		return typeof value === 'string' && value.toLowerCase() === lowerLogin;
	});
	return found !== undefined ? found : '';
}

function mergeAliases(existingAliases, profileName) {
	const aliases = Array.isArray(existingAliases) ? existingAliases.map(normalizeWhitespace) : [];
	if (profileName) {
		aliases.push(profileName);
	}
	return uniqueCaseInsensitive(aliases);
}

function isYes(answer) {
	return /^(y|yes)$/i.test(normalizeWhitespace(answer));
}

async function promptForConfirmation(message, promptFn) {
	if (typeof promptFn === 'function') {
		return promptFn(message);
	}

	if (!process.stdin.isTTY) {
		throw new Error('Interactive confirmation requires a TTY.');
	}

	const interfaceHandle = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	try {
		return await interfaceHandle.question(message);
	} finally {
		interfaceHandle.close();
	}
}

function buildUsersObject(members, existingUsers) {
	const users = {};
	for (const member of members) {
		const login = normalizeWhitespace(member.login);
		if (!login) continue;

		const profileName = member.name ? normalizeWhitespace(member.name) : '';
		const displayName = profileName || findExistingNameForLogin(existingUsers, login) || login;
		users[displayName] = login;
	}

	return Object.fromEntries(
		Object.entries(users).sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
	);
}

async function fetchJson(url, token) {
	const headers = {
		'Accept': 'application/vnd.github+json',
		'User-Agent': 'Now-Micro-actions-populate-users'
	};

	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitHub API request failed for ${url}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
	}

	return response.json();
}

async function fetchOrgMembers(org, token) {
	const members = [];
	for (let page = 1; ; page += 1) {
		const url = `${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/members?per_page=100&page=${page}`;
		const pageMembers = await fetchJson(url, token);
		if (!Array.isArray(pageMembers) || pageMembers.length === 0) {
			break;
		}
		members.push(...pageMembers);
	}
	return members;
}

async function fetchMemberProfiles(members, token) {
	const profiles = [];
	for (const member of members) {
		const login = normalizeWhitespace(member.login);
		if (!login) continue;

		const profile = await fetchJson(`${GITHUB_API_BASE}/users/${encodeURIComponent(login)}`, token);
		profiles.push({
			login,
			name: typeof profile.name === 'string' ? profile.name : ''
		});
	}
	return profiles;
}

function logStartupContext({ org, outputFile, token }) {
	console.log('🚦 Starting users.json population');
	console.log(`📦 Org:         ${org}`);
	console.log(`🗂️  Output file: ${outputFile}`);
	console.log(`🔐 Token:       ${token ? 'provided' : 'not provided'}`);
	if (!token) {
		console.log('ℹ️  Provide GITHUB_TOKEN or INPUT_GITHUB_TOKEN to include private org members.');
	}
}

async function run(options = {}) {
	const promptFn = options.prompt;
	const cliArgs = options.argv || process.argv.slice(2);
	const parsedArgs = parseArgs(cliArgs);
	const org = normalizeWhitespace(options.org || parsedArgs.org || process.env.INPUT_ORG || DEFAULT_ORG);
	const outputFile = normalizeWhitespace(options.outputFile || parsedArgs.outputFile || process.env.INPUT_OUTPUT_FILE || DEFAULT_OUTPUT_FILE);
	const token = options.token || parsedArgs.token || process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN || '';

	if (!fs.existsSync(path.dirname(outputFile))) {
		console.error(`❌ Output directory does not exist: ${path.dirname(outputFile)}`);
		process.exit(1);
	}

	try {
		logStartupContext({ org, outputFile, token });
		const members = await fetchOrgMembers(org, token);
		console.log(`ℹ️  GitHub returned ${members.length} org member${members.length === 1 ? '' : 's'}.`);
		if (members.length === 0) {
			console.log('⚠️  No org members were returned. If this org has private members, provide a token with read:org scope.');
		}
		const profiles = await fetchMemberProfiles(members, token);
		const existingUsers = loadExistingUsers(outputFile);
		const users = buildUsersObject(profiles, existingUsers);
		const nextContent = `${JSON.stringify(users, null, 4)}\n`;
		const currentContent = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';

		if (currentContent === nextContent) {
			console.log(`ℹ️  No changes detected for ${outputFile}`);
			return;
		}

		const confirmation = await promptForConfirmation(
			`About to write ${Object.keys(users).length} users to ${outputFile}. Continue? [y/N] `,
			promptFn
		);

		if (!isYes(confirmation)) {
			console.log('ℹ️  Aborted. No files were changed.');
			return;
		}

		fs.writeFileSync(outputFile, nextContent);

		console.log(`✅ Wrote ${Object.keys(users).length} users to ${outputFile}`);
	} catch (error) {
		console.error(`❌ Failed to populate users.json: ${error.message}`);
		process.exit(1);
	}
}

if (require.main === module) {
	run();
}

module.exports = {
	buildUsersObject,
	findExistingNameForLogin,
	fetchMemberProfiles,
	fetchOrgMembers,
	loadExistingUsers,
	mergeAliases,
	isYes,
	normalizeWhitespace,
	promptForConfirmation,
	logStartupContext,
	run,
	uniqueCaseInsensitive
};

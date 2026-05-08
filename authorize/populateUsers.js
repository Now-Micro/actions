const fs = require('fs');
const path = require('path');

const DEFAULT_ORG = 'Now-Micro';
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'users.json');
const GITHUB_API_BASE = 'https://api.github.com';

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

	return parsed;
}

function mergeAliases(existingAliases, profileName) {
	const aliases = Array.isArray(existingAliases) ? existingAliases.map(normalizeWhitespace) : [];
	if (profileName) {
		aliases.push(profileName);
	}
	return uniqueCaseInsensitive(aliases);
}

function buildUsersObject(members, existingUsers) {
	const users = {};
	for (const member of members) {
		const login = normalizeWhitespace(member.login);
		if (!login) continue;

		const existingAliases = existingUsers[login] ?? existingUsers[Object.keys(existingUsers).find(key => key.toLowerCase() === login.toLowerCase())];
		const profileName = member.name ? normalizeWhitespace(member.name) : '';
		users[login] = mergeAliases(existingAliases, profileName);
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

async function run() {
	const org = normalizeWhitespace(process.env.INPUT_ORG || DEFAULT_ORG);
	const outputFile = normalizeWhitespace(process.env.INPUT_OUTPUT_FILE || DEFAULT_OUTPUT_FILE);
	const token = process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN || '';

	if (!org) {
		console.error('❌ INPUT_ORG is required');
		process.exit(1);
	}

	if (!outputFile) {
		console.error('❌ INPUT_OUTPUT_FILE is required');
		process.exit(1);
	}

	if (!fs.existsSync(path.dirname(outputFile))) {
		console.error(`❌ Output directory does not exist: ${path.dirname(outputFile)}`);
		process.exit(1);
	}

	try {
		const members = await fetchOrgMembers(org, token);
		const profiles = await fetchMemberProfiles(members, token);
		const existingUsers = loadExistingUsers(outputFile);
		const users = buildUsersObject(profiles, existingUsers);
		fs.writeFileSync(outputFile, `${JSON.stringify(users, null, 4)}\n`);

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
	fetchMemberProfiles,
	fetchOrgMembers,
	loadExistingUsers,
	mergeAliases,
	normalizeWhitespace,
	run,
	uniqueCaseInsensitive
};

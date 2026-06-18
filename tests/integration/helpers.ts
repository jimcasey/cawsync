import { GitHubClient } from '../../src/github-client';

export { InMemoryVaultAdapter, InMemoryStateAdapter } from './in-memory-adapters';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export interface IntegrationConfig {
	token: string;
	owner: string;
	repo: string;
	seedBranch: string;
}

export function loadConfig(): IntegrationConfig {
	const token = process.env['JACKDAW_GH_TOKEN'];
	const repoFull = process.env['JACKDAW_TEST_REPO'];
	const seedBranch = process.env['JACKDAW_TEST_SEED_BRANCH'] ?? 'main';

	if (!token) {
		throw new Error(
			'JACKDAW_GH_TOKEN is not set. Integration tests require a fine-grained PAT scoped to the sandbox repo.',
		);
	}
	if (!repoFull) {
		throw new Error(
			'JACKDAW_TEST_REPO is not set. Set it to "owner/repo" of the integration sandbox repository.',
		);
	}

	const slash = repoFull.indexOf('/');
	if (slash <= 0 || slash === repoFull.length - 1) {
		throw new Error(`JACKDAW_TEST_REPO must be "owner/repo", got "${repoFull}".`);
	}

	return {
		token,
		owner: repoFull.slice(0, slash),
		repo: repoFull.slice(slash + 1),
		seedBranch,
	};
}

export function makeClient(cfg: IntegrationConfig): GitHubClient {
	return new GitHubClient(
		() => cfg.token,
		() => cfg.owner,
		() => cfg.repo,
		'integration',
	);
}

export function uniqueBranchName(prefix = 'ci'): string {
	const stamp = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${prefix}/${stamp}-${rand}`;
}

async function gh(
	cfg: IntegrationConfig,
	method: string,
	path: string,
	body?: unknown,
	accept = 'application/vnd.github+json',
): Promise<Response> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${cfg.token}`,
		Accept: accept,
		'X-GitHub-Api-Version': API_VERSION,
	};
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	const res = await fetch(`${GITHUB_API}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	}
	return res;
}

interface BranchResponse {
	commit: { sha: string; commit: { tree: { sha: string } } };
}

export async function createTestBranch(cfg: IntegrationConfig, name: string): Promise<void> {
	const seed = (await gh(
		cfg,
		'GET',
		`/repos/${cfg.owner}/${cfg.repo}/branches/${cfg.seedBranch}`,
	).then(r => r.json())) as BranchResponse;

	await gh(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
		ref: `refs/heads/${name}`,
		sha: seed.commit.sha,
	});
}

export async function deleteTestBranch(cfg: IntegrationConfig, name: string): Promise<void> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${cfg.token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': API_VERSION,
	};
	const res = await fetch(
		`${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${name}`,
		{ method: 'DELETE', headers },
	);
	// 422 is returned if the ref doesn't exist; treat as already-gone.
	if (!res.ok && res.status !== 404 && res.status !== 422) {
		throw new Error(`Failed to delete branch ${name}: ${res.status} ${await res.text()}`);
	}
}

export async function seedFiles(
	cfg: IntegrationConfig,
	branch: string,
	files: Record<string, string>,
): Promise<{ commitSha: string }> {
	const tip = (await gh(
		cfg,
		'GET',
		`/repos/${cfg.owner}/${cfg.repo}/branches/${branch}`,
	).then(r => r.json())) as BranchResponse;

	const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
	for (const [path, content] of Object.entries(files)) {
		const blob = (await gh(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
			content,
			encoding: 'utf-8',
		}).then(r => r.json())) as { sha: string };
		treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
	}

	const tree = (await gh(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
		base_tree: tip.commit.commit.tree.sha,
		tree: treeEntries,
	}).then(r => r.json())) as { sha: string };

	const commit = (await gh(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
		message: `integration seed: ${Object.keys(files).join(', ')}`.slice(0, 200),
		tree: tree.sha,
		parents: [tip.commit.sha],
	}).then(r => r.json())) as { sha: string };

	await gh(cfg, 'PATCH', `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${branch}`, {
		sha: commit.sha,
		force: false,
	});

	return { commitSha: commit.sha };
}

export async function readFiles(
	cfg: IntegrationConfig,
	branch: string,
	paths: string[],
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const path of paths) {
		const res = await gh(
			cfg,
			'GET',
			`/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`,
			undefined,
			'application/vnd.github.raw',
		);
		result[path] = await res.text();
	}
	return result;
}


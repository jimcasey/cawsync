import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
	createTestBranch,
	deleteTestBranch,
	loadConfig,
	makeClient,
	readFiles,
	seedFiles,
	uniqueBranchName,
	InMemoryStateAdapter,
	InMemoryVaultAdapter,
	type IntegrationConfig,
} from './helpers';

describe('integration harness smoke', () => {
	let cfg: IntegrationConfig;
	let branch: string;

	beforeAll(async () => {
		cfg = loadConfig();
		branch = uniqueBranchName('smoke');
		await createTestBranch(cfg, branch);
	});

	afterAll(async () => {
		if (branch) await deleteTestBranch(cfg, branch);
	});

	test('seeds files, reads them via the GitHub client, and reads them back via helpers', async () => {
		await seedFiles(cfg, branch, {
			'hello.md': 'Hi from smoke test\n',
			'sub/dir/note.md': 'Nested\n',
		});

		const client = makeClient(cfg);
		const { commitSha, treeSha } = await client.getBranch(cfg.owner, cfg.repo, branch);
		expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

		const tree = await client.getTree(cfg.owner, cfg.repo, treeSha, true);
		const blobPaths = tree.tree.filter(e => e.type === 'blob').map(e => e.path);
		expect(blobPaths).toContain('hello.md');
		expect(blobPaths).toContain('sub/dir/note.md');

		const contents = await readFiles(cfg, branch, ['hello.md', 'sub/dir/note.md']);
		expect(contents['hello.md']).toBe('Hi from smoke test\n');
		expect(contents['sub/dir/note.md']).toBe('Nested\n');
	});

	test('in-memory adapters round-trip writes and reads', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('a.md', 'one');
		await vault.writeText('dir/b.md', 'two');

		expect(await vault.exists('a.md')).toBe(true);
		expect((await vault.listFiles()).sort()).toEqual(['a.md', 'dir/b.md']);
		expect(await vault.readText('a.md')).toBe('one');

		const dirListing = await vault.listDirectory('dir');
		expect(dirListing.files).toEqual(['b.md']);

		const state = new InMemoryStateAdapter();
		await state.write('plugins/jackdaw/sync-state.json.tmp', '{"v":1}');
		await state.rename(
			'plugins/jackdaw/sync-state.json.tmp',
			'plugins/jackdaw/sync-state.json',
		);
		expect(await state.exists('plugins/jackdaw/sync-state.json')).toBe(true);
		expect(await state.read('plugins/jackdaw/sync-state.json')).toBe('{"v":1}');
	});
});

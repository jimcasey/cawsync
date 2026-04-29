import { describe, test, expect, vi } from 'vitest';
import { buildRemoteChangeSet } from '../src/remote-change-set';
import type { GitHubClient, TreeResponse } from '../src/github-client';
import type { SyncState, SyncedFileRecord } from '../src/state-store';

const BASE_STATE: SyncState = {
	schemaVersion: 1,
	lastSyncCommitSha: null,
	lastSyncAt: '2026-01-01T00:00:00Z',
	files: {},
};

// Keys are `${treeSha}:${recursive}` or just `${treeSha}` as a fallback.
function makeClient(responses: Map<string, TreeResponse>): GitHubClient {
	return {
		getTree: vi.fn((owner: string, repo: string, treeSha: string, recursive: boolean) => {
			const key = `${treeSha}:${recursive}`;
			const response = responses.get(key) ?? responses.get(treeSha);
			if (!response) throw new Error(`No mock response for treeSha: ${treeSha} recursive: ${recursive}`);
			return Promise.resolve(response);
		}),
	} as unknown as GitHubClient;
}

function stateWithFiles(entries: Array<{ path: string; blobSha: string; isBinary?: boolean }>): SyncState {
	const files: Record<string, SyncedFileRecord> = {};
	for (const e of entries) {
		files[e.path] = {
			path: e.path,
			blobSha: e.blobSha,
			contentHash: 'some-hash',
			size: 100,
			isBinary: e.isBinary ?? false,
		};
	}
	return { ...BASE_STATE, files };
}

function treeResponse(treeSha: string, items: TreeResponse['tree'], truncated = false): TreeResponse {
	return { sha: treeSha, url: '', tree: items, truncated };
}

describe('buildRemoteChangeSet', () => {
	test('path absent from state, present in tree → added', async () => {
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'notes/hello.md', mode: '100644', type: 'blob', sha: 'blob-abc', size: 42 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		expect(result.size).toBe(1);
		const entry = result.get('notes/hello.md');
		expect(entry?.type).toBe('added');
		expect(entry?.blobSha).toBe('blob-abc');
		expect(entry?.size).toBe(42);
		expect(entry?.isBinary).toBe(false);
	});

	test('path in state, blob SHA differs → modified', async () => {
		const state = stateWithFiles([{ path: 'notes/hello.md', blobSha: 'old-blob' }]);
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'notes/hello.md', mode: '100644', type: 'blob', sha: 'new-blob', size: 50 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', state);

		expect(result.size).toBe(1);
		const entry = result.get('notes/hello.md');
		expect(entry?.type).toBe('modified');
		expect(entry?.blobSha).toBe('new-blob');
	});

	test('path in state, blob SHA matches → not in output', async () => {
		const state = stateWithFiles([{ path: 'notes/hello.md', blobSha: 'blob-abc' }]);
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'notes/hello.md', mode: '100644', type: 'blob', sha: 'blob-abc', size: 42 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', state);

		expect(result.has('notes/hello.md')).toBe(false);
		expect(result.size).toBe(0);
	});

	test('path in state, absent from tree → deleted', async () => {
		const state = stateWithFiles([{ path: 'notes/gone.md', blobSha: 'blob-gone' }]);
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', state);

		expect(result.size).toBe(1);
		const entry = result.get('notes/gone.md');
		expect(entry?.type).toBe('deleted');
		expect(entry?.blobSha).toBeUndefined();
		expect(entry?.size).toBe(0);
	});

	test('deleted entry inherits isBinary from state record', async () => {
		const state = stateWithFiles([{ path: 'photo.png', blobSha: 'blob-png', isBinary: true }]);
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', state);

		expect(result.get('photo.png')?.isBinary).toBe(true);
	});

	test('binary file detected by extension', async () => {
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'photo.png', mode: '100644', type: 'blob', sha: 'blob-png', size: 2048 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		expect(result.get('photo.png')?.isBinary).toBe(true);
	});

	test('tree entries are not included in output', async () => {
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'subdir', mode: '040000', type: 'tree', sha: 'subtree-sha' },
				{ path: 'subdir/file.md', mode: '100644', type: 'blob', sha: 'blob-sub', size: 10 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		expect(result.has('subdir')).toBe(false);
		expect(result.has('subdir/file.md')).toBe(true);
	});

	test('truncated: true triggers subtree walk with full path reconstruction', async () => {
		const responses = new Map<string, TreeResponse>([
			['root-sha:true', treeResponse('root-sha', [], true)],
			['root-sha:false', treeResponse('root-sha', [
				{ path: 'readme.md', mode: '100644', type: 'blob', sha: 'blob-readme', size: 30 },
				{ path: 'subdir', mode: '040000', type: 'tree', sha: 'subtree-sha' },
			])],
			['subtree-sha:false', treeResponse('subtree-sha', [
				{ path: 'file.md', mode: '100644', type: 'blob', sha: 'blob-file', size: 20 },
			])],
		]);
		const client = makeClient(responses);

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		expect(result.size).toBe(2);
		expect(result.get('readme.md')?.type).toBe('added');
		expect(result.get('subdir/file.md')?.type).toBe('added');
	});

	test('truncated walk: nested subtrees accumulate full paths', async () => {
		const responses = new Map<string, TreeResponse>([
			['root-sha:true', treeResponse('root-sha', [], true)],
			['root-sha:false', treeResponse('root-sha', [
				{ path: 'a', mode: '040000', type: 'tree', sha: 'sha-a' },
			])],
			['sha-a:false', treeResponse('sha-a', [
				{ path: 'b', mode: '040000', type: 'tree', sha: 'sha-ab' },
			])],
			['sha-ab:false', treeResponse('sha-ab', [
				{ path: 'deep.md', mode: '100644', type: 'blob', sha: 'blob-deep', size: 5 },
			])],
		]);
		const client = makeClient(responses);

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		expect(result.size).toBe(1);
		expect(result.get('a/b/deep.md')?.type).toBe('added');
	});

	test('truncated walk: visited set prevents revisiting duplicate sha', async () => {
		const responses = new Map<string, TreeResponse>([
			['root-sha:true', treeResponse('root-sha', [], true)],
			['root-sha:false', treeResponse('root-sha', [
				{ path: 'dir1', mode: '040000', type: 'tree', sha: 'same-sha' },
				{ path: 'dir2', mode: '040000', type: 'tree', sha: 'same-sha' },
			])],
			['same-sha:false', treeResponse('same-sha', [
				{ path: 'file.md', mode: '100644', type: 'blob', sha: 'blob-x', size: 10 },
			])],
		]);
		const getTree = vi.fn((owner: string, repo: string, treeSha: string, recursive: boolean) => {
			const key = `${treeSha}:${recursive}`;
			const response = responses.get(key);
			if (!response) throw new Error(`No mock for ${key}`);
			return Promise.resolve(response);
		});
		const client = { getTree } as unknown as GitHubClient;

		await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', BASE_STATE);

		// same-sha should only be fetched once despite appearing twice
		const sameShaCalls = getTree.mock.calls.filter(
			([, , sha, recursive]) => sha === 'same-sha' && recursive === false,
		);
		expect(sameShaCalls.length).toBe(1);
	});

	test('mix of added, modified, unchanged, and deleted', async () => {
		const state = stateWithFiles([
			{ path: 'unchanged.md', blobSha: 'blob-same' },
			{ path: 'modified.md', blobSha: 'blob-old' },
			{ path: 'deleted.md', blobSha: 'blob-del' },
		]);
		const client = makeClient(new Map([
			['root-sha', treeResponse('root-sha', [
				{ path: 'unchanged.md', mode: '100644', type: 'blob', sha: 'blob-same', size: 10 },
				{ path: 'modified.md', mode: '100644', type: 'blob', sha: 'blob-new', size: 15 },
				{ path: 'new.md', mode: '100644', type: 'blob', sha: 'blob-fresh', size: 5 },
			])],
		]));

		const result = await buildRemoteChangeSet(client, 'owner', 'repo', 'root-sha', state);

		expect(result.has('unchanged.md')).toBe(false);
		expect(result.get('modified.md')?.type).toBe('modified');
		expect(result.get('new.md')?.type).toBe('added');
		expect(result.get('deleted.md')?.type).toBe('deleted');
		expect(result.size).toBe(3);
	});
});

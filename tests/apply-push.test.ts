import { describe, test, expect, vi, type Mock } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import { applyPush, formatCommitMessage, type PushLogger } from '../src/apply-push';
import { GHFastForwardError } from '../src/github-client';
import type { ClassifiedPath, LocalChange } from '../src/sync-engine-types';
import type { SyncState } from '../src/state-store';
import type { Settings } from '../src/settings';
import type { GitHubClient } from '../src/github-client';

function toBytes(s: string): ArrayBuffer {
	return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

interface MockClient {
	createBlob: Mock;
	createTree: Mock;
	createCommit: Mock;
	updateRef: Mock;
}

function makeClient(): MockClient {
	return {
		createBlob: vi.fn().mockResolvedValue({ sha: 'blob-sha' }),
		createTree: vi.fn().mockResolvedValue({ sha: 'new-tree-sha' }),
		createCommit: vi.fn().mockResolvedValue({ sha: 'new-commit-sha' }),
		updateRef: vi.fn().mockResolvedValue(undefined),
	};
}

function asClient(mock: MockClient): GitHubClient {
	return mock as unknown as GitHubClient;
}

function makeLogger(): PushLogger & { debug: Mock } {
	return { debug: vi.fn().mockResolvedValue(undefined) };
}

function makeState(overrides: Partial<SyncState> = {}): SyncState {
	return {
		schemaVersion: 1,
		lastSyncCommitSha: 'old-commit-sha',
		lastSyncAt: '2026-01-01T00:00:00.000Z',
		files: {},
		...overrides,
	};
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		owner: 'test-owner',
		repo: 'test-repo',
		branch: 'main',
		pat: 'test-pat',
		conflictPolicy: 'always-ask',
		perFileSizeLimitMb: 25,
		deviceName: 'MyDevice',
		includeObsidianConfig: false,
		excludePatterns: [],
		verboseLogging: false,
		...overrides,
	};
}

function makeClassified(
	path: string,
	local: ClassifiedPath['local'],
	action: ClassifiedPath['action'] = 'push',
	remote: ClassifiedPath['remote'] = 'unchanged',
): ClassifiedPath {
	return { path, action, local, remote };
}

function makeLocalChange(
	path: string,
	type: LocalChange['type'],
	content = 'content',
): LocalChange {
	const bytes = type !== 'deleted' ? toBytes(content) : undefined;
	return {
		path,
		type,
		contentHash: `hash-${path}`,
		bytes,
		size: bytes?.byteLength ?? 0,
		isBinary: false,
	};
}

// ---------------------------------------------------------------------------
// formatCommitMessage
// ---------------------------------------------------------------------------

describe('formatCommitMessage', () => {
	test('standard case: correct header, count, and prefixed file list', () => {
		const result = formatCommitMessage('MyDevice', {
			added: ['new.md'],
			modified: ['changed.md'],
			deleted: ['gone.md'],
		});

		const lines = result.split('\n');
		expect(lines[0]).toMatch(/^Obsidian sync from MyDevice at \d{4}-\d{2}-\d{2}T/);
		expect(lines[1]).toBe('');
		expect(lines[2]).toBe('3 file(s) changed:');
		expect(lines[3]).toBe('+ new.md');
		expect(lines[4]).toBe('~ changed.md');
		expect(lines[5]).toBe('- gone.md');
	});

	test('empty file list: header shows 0 file(s) changed with no extra lines', () => {
		const result = formatCommitMessage('Bot', { added: [], modified: [], deleted: [] });

		const lines = result.split('\n');
		expect(lines[2]).toBe('0 file(s) changed:');
		expect(lines).toHaveLength(3);
	});

	test('file list > 50 entries: truncated with "... and N more"', () => {
		const added = Array.from({ length: 55 }, (_, i) => `note${i}.md`);
		const result = formatCommitMessage('Dev', { added, modified: [], deleted: [] });

		const lines = result.split('\n');
		// header + empty + count + 50 entries + truncation line = 54 lines
		expect(lines).toHaveLength(54);
		expect(lines[3 + 50 - 1]).toBe('+ note49.md');
		expect(lines[3 + 50]).toBe('... and 5 more');
		expect(result).not.toContain('+ note50.md');
	});

	test('file list exactly 50 entries: not truncated', () => {
		const added = Array.from({ length: 50 }, (_, i) => `note${i}.md`);
		const result = formatCommitMessage('Dev', { added, modified: [], deleted: [] });

		expect(result).not.toContain('... and');
		expect(result).toContain('+ note49.md');
	});

	test('deviceName empty string: falls back gracefully (no crash)', () => {
		const result = formatCommitMessage('', { added: ['a.md'], modified: [], deleted: [] });
		expect(result).toContain('Obsidian sync from  at ');
	});
});

// ---------------------------------------------------------------------------
// applyPush
// ---------------------------------------------------------------------------

describe('applyPush', () => {
	test('empty paths: early return, no API calls', async () => {
		const client = makeClient();
		const state = makeState();
		const logger = makeLogger();

		const result = await applyPush(
			[],
			new Map(),
			state,
			asClient(client),
			makeSettings(),
			'remote-head-sha',
			'remote-tree-sha',
			logger,
		);

		expect(client.createBlob).not.toHaveBeenCalled();
		expect(client.createTree).not.toHaveBeenCalled();
		expect(client.createCommit).not.toHaveBeenCalled();
		expect(client.updateRef).not.toHaveBeenCalled();
		expect(result.newCommitSha).toBe('remote-head-sha');
		expect(result.updatedState).toBe(state);
	});

	test('mixed add/modify/delete: blobs created serially, correct tree entries, commit and ref updated', async () => {
		const client = makeClient();
		client.createBlob
			.mockResolvedValueOnce({ sha: 'blob-added' })
			.mockResolvedValueOnce({ sha: 'blob-modified' });

		const logger = makeLogger();
		const state = makeState({
			files: {
				'modified.md': {
					path: 'modified.md',
					blobSha: 'old-blob',
					contentHash: 'old-hash',
					size: 10,
					isBinary: false,
				},
				'deleted.md': {
					path: 'deleted.md',
					blobSha: 'del-blob',
					contentHash: 'del-hash',
					size: 5,
					isBinary: false,
				},
			},
		});

		const local = new Map<string, LocalChange>([
			['added.md', makeLocalChange('added.md', 'added', 'new content')],
			['modified.md', makeLocalChange('modified.md', 'modified', 'updated content')],
			['deleted.md', makeLocalChange('deleted.md', 'deleted')],
		]);

		const paths = [
			makeClassified('added.md', 'added'),
			makeClassified('modified.md', 'modified'),
			makeClassified('deleted.md', 'deleted'),
		];

		const result = await applyPush(
			paths,
			local,
			state,
			asClient(client),
			makeSettings(),
			'remote-head',
			'remote-tree',
			logger,
		);

		// Blobs created serially (added then modified, no concurrent calls)
		expect(client.createBlob).toHaveBeenCalledTimes(2);
		expect(client.createBlob).toHaveBeenNthCalledWith(
			1,
			'test-owner',
			'test-repo',
			local.get('added.md')!.bytes,
			false,
		);
		expect(client.createBlob).toHaveBeenNthCalledWith(
			2,
			'test-owner',
			'test-repo',
			local.get('modified.md')!.bytes,
			false,
		);

		// Tree entries include add, modify, and delete
		expect(client.createTree).toHaveBeenCalledWith('test-owner', 'test-repo', 'remote-tree', [
			{ path: 'added.md', mode: '100644', type: 'blob', sha: 'blob-added' },
			{ path: 'modified.md', mode: '100644', type: 'blob', sha: 'blob-modified' },
			{ path: 'deleted.md', mode: '100644', type: 'blob', sha: null },
		]);

		// Commit uses generated message and correct parents
		const commitCall = client.createCommit.mock.calls[0];
		expect(commitCall[0]).toBe('test-owner');
		expect(commitCall[1]).toBe('test-repo');
		expect(commitCall[2]).toContain('Obsidian sync from MyDevice at');
		expect(commitCall[3]).toBe('new-tree-sha');
		expect(commitCall[4]).toBe('remote-head');

		expect(client.updateRef).toHaveBeenCalledWith('test-owner', 'test-repo', 'main', 'new-commit-sha');

		expect(result.newCommitSha).toBe('new-commit-sha');
		expect(logger.debug).toHaveBeenCalledTimes(2);
	});

	test('GHFastForwardError from updateRef bubbles to caller', async () => {
		const client = makeClient();
		client.updateRef.mockRejectedValue(new GHFastForwardError('fast-forward required'));

		const local = new Map([['note.md', makeLocalChange('note.md', 'added')]]);
		const paths = [makeClassified('note.md', 'added')];

		await expect(
			applyPush(
				paths,
				local,
				makeState(),
				asClient(client),
				makeSettings(),
				'remote-head',
				'remote-tree',
				makeLogger(),
			),
		).rejects.toThrow(GHFastForwardError);
	});

	test('modified path: state record updated with new blobSha and lastSyncAt refreshed', async () => {
		const client = makeClient();
		client.createBlob.mockResolvedValue({ sha: 'new-blob-sha' });

		const state = makeState({
			files: {
				'modified.md': { path: 'modified.md', blobSha: 'old-blob', contentHash: 'old-hash', size: 5, isBinary: false },
			},
		});
		const local = new Map([['modified.md', makeLocalChange('modified.md', 'modified', 'new content')]]);
		const paths = [makeClassified('modified.md', 'modified')];

		const before = Date.now();
		const result = await applyPush(
			paths,
			local,
			state,
			asClient(client),
			makeSettings(),
			'remote-head',
			'remote-tree',
			makeLogger(),
		);
		const after = Date.now();

		expect(result.updatedState.lastSyncCommitSha).toBe('new-commit-sha');

		const syncAt = new Date(result.updatedState.lastSyncAt).getTime();
		expect(syncAt).toBeGreaterThanOrEqual(before);
		expect(syncAt).toBeLessThanOrEqual(after);

		expect(result.updatedState.files['modified.md']).toEqual({
			path: 'modified.md',
			blobSha: 'new-blob-sha',
			contentHash: 'hash-modified.md',
			size: local.get('modified.md')!.size,
			isBinary: false,
		});
	});

	test('added path: new SyncedFileRecord created in state', async () => {
		const client = makeClient();
		client.createBlob.mockResolvedValue({ sha: 'new-blob-sha' });

		const state = makeState(); // no pre-existing files
		const local = new Map([['new.md', makeLocalChange('new.md', 'added', 'hello')]]);
		const paths = [makeClassified('new.md', 'added')];

		const result = await applyPush(
			paths,
			local,
			state,
			asClient(client),
			makeSettings(),
			'remote-head',
			'remote-tree',
			makeLogger(),
		);

		expect(result.updatedState.files['new.md']).toEqual({
			path: 'new.md',
			blobSha: 'new-blob-sha',
			contentHash: 'hash-new.md',
			size: local.get('new.md')!.size,
			isBinary: false,
		});
	});

	test('keep-local conflict resolution: path with action=conflict is pushed based on local change type', async () => {
		const client = makeClient();
		client.createBlob.mockResolvedValue({ sha: 'conflict-blob-sha' });

		const state = makeState({
			files: {
				'conflict.md': { path: 'conflict.md', blobSha: 'old-blob', contentHash: 'old-hash', size: 5, isBinary: false },
			},
		});
		const local = new Map([['conflict.md', makeLocalChange('conflict.md', 'modified', 'local wins')]]);
		// action is 'conflict' but caller resolved as keep-local, so it's passed to applyPush
		const paths = [makeClassified('conflict.md', 'modified', 'conflict', 'modified')];

		const result = await applyPush(
			paths,
			local,
			state,
			asClient(client),
			makeSettings(),
			'remote-head',
			'remote-tree',
			makeLogger(),
		);

		expect(client.createBlob).toHaveBeenCalledTimes(1);
		expect(result.updatedState.files['conflict.md'].blobSha).toBe('conflict-blob-sha');
		expect(result.newCommitSha).toBe('new-commit-sha');
	});

	test('deleted files removed from state after push', async () => {
		const state = makeState({
			files: {
				'keep.md': { path: 'keep.md', blobSha: 'b1', contentHash: 'h1', size: 1, isBinary: false },
				'gone.md': { path: 'gone.md', blobSha: 'b2', contentHash: 'h2', size: 2, isBinary: false },
			},
		});

		const local = new Map([['gone.md', makeLocalChange('gone.md', 'deleted')]]);
		const paths = [makeClassified('gone.md', 'deleted')];

		const result = await applyPush(
			paths,
			local,
			state,
			asClient(makeClient()),
			makeSettings(),
			'remote-head',
			'remote-tree',
			makeLogger(),
		);

		expect(result.updatedState.files['gone.md']).toBeUndefined();
		expect(result.updatedState.files['keep.md']).toBeDefined();
	});

	test('deviceName falls back to "Obsidian" when empty', async () => {
		const client = makeClient();
		const local = new Map([['note.md', makeLocalChange('note.md', 'added')]]);
		const paths = [makeClassified('note.md', 'added')];

		await applyPush(
			paths,
			local,
			makeState(),
			asClient(client),
			makeSettings({ deviceName: '' }),
			'remote-head',
			'remote-tree',
			makeLogger(),
		);

		const commitMessage = client.createCommit.mock.calls[0][2] as string;
		expect(commitMessage).toContain('Obsidian sync from Obsidian at');
	});
});

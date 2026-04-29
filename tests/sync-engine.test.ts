import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
vi.mock('../src/local-change-set', () => ({ buildLocalChangeSet: vi.fn() }));
vi.mock('../src/remote-change-set', () => ({ buildRemoteChangeSet: vi.fn() }));
vi.mock('../src/classifier', () => ({ classify: vi.fn() }));
vi.mock('../src/apply-pull', () => ({ applyPull: vi.fn() }));
vi.mock('../src/apply-push', () => ({ applyPush: vi.fn() }));
vi.mock('../src/first-sync', () => ({
	buildLocalInventory: vi.fn(),
	buildFirstSyncSummary: vi.fn(),
}));

import { SyncEngine, type SyncLogger } from '../src/sync-engine';
import { buildLocalChangeSet } from '../src/local-change-set';
import { buildRemoteChangeSet } from '../src/remote-change-set';
import { classify } from '../src/classifier';
import { applyPull } from '../src/apply-pull';
import { applyPush } from '../src/apply-push';
import { buildLocalInventory, buildFirstSyncSummary } from '../src/first-sync';
import { GHFastForwardError } from '../src/github-client';
import type { GitHubClient } from '../src/github-client';
import type { StateStore, SyncState } from '../src/state-store';
import type {
	VaultAdapter,
	ConflictResolver,
	FirstSyncResolver,
	LocalChange,
	RemoteChange,
	ClassifiedPath,
	FirstSyncSummary,
} from '../src/sync-engine-types';
import type { Settings } from '../src/settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): SyncLogger & { debug: Mock; info: Mock; warn: Mock; error: Mock } {
	return {
		debug: vi.fn().mockResolvedValue(undefined),
		info: vi.fn().mockResolvedValue(undefined),
		warn: vi.fn().mockResolvedValue(undefined),
		error: vi.fn().mockResolvedValue(undefined),
	};
}

interface MockStateStore {
	load: Mock;
	save: Mock;
}

function makeStateStore(state: SyncState | null = null): MockStateStore {
	return {
		load: vi.fn().mockResolvedValue(state),
		save: vi.fn().mockResolvedValue(undefined),
	};
}

interface MockClient {
	getBranch: Mock;
	getTree: Mock;
	getBlob: Mock;
	createBlob: Mock;
	createTree: Mock;
	createCommit: Mock;
	updateRef: Mock;
}

function makeClient(): MockClient {
	return {
		getBranch: vi.fn().mockResolvedValue({ commitSha: 'remote-head', treeSha: 'remote-tree' }),
		getTree: vi.fn().mockResolvedValue({ tree: [], truncated: false }),
		getBlob: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		createBlob: vi.fn().mockResolvedValue({ sha: 'new-blob' }),
		createTree: vi.fn().mockResolvedValue({ sha: 'new-tree' }),
		createCommit: vi.fn().mockResolvedValue({ sha: 'new-commit' }),
		updateRef: vi.fn().mockResolvedValue(undefined),
	};
}

interface MockVault {
	listFiles: Mock;
	listDirectory: Mock;
	readText: Mock;
	readBinary: Mock;
	writeText: Mock;
	writeBinary: Mock;
	delete: Mock;
	exists: Mock;
}

function makeVault(): MockVault {
	return {
		listFiles: vi.fn().mockResolvedValue([]),
		listDirectory: vi.fn().mockResolvedValue({ files: [], dirs: [] }),
		readText: vi.fn().mockResolvedValue(''),
		readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		writeText: vi.fn().mockResolvedValue(undefined),
		writeBinary: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		exists: vi.fn().mockResolvedValue(false),
	};
}

function makeConflictResolver(): { resolve: Mock } {
	return { resolve: vi.fn().mockResolvedValue(new Map()) };
}

function makeFirstSyncResolver(): { resolve: Mock } {
	return { resolve: vi.fn().mockResolvedValue(new Map()) };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		owner: 'test-owner',
		repo: 'test-repo',
		branch: 'main',
		pat: 'test-pat',
		conflictPolicy: 'always-ask',
		perFileSizeLimitMb: 25,
		deviceName: 'TestDevice',
		includeObsidianConfig: false,
		excludePatterns: [],
		verboseLogging: false,
		...overrides,
	};
}

function makeState(overrides: Partial<SyncState> = {}): SyncState {
	return {
		schemaVersion: 1,
		lastSyncCommitSha: 'old-commit',
		lastSyncAt: '2026-01-01T00:00:00.000Z',
		files: {},
		...overrides,
	};
}

function makeLocalChange(path: string, type: LocalChange['type'] = 'added'): LocalChange {
	return { path, type, contentHash: `hash-${path}`, size: 10, isBinary: false };
}

function makeRemoteChange(path: string, type: RemoteChange['type'] = 'added'): RemoteChange {
	return { path, type, blobSha: `blob-${path}`, size: 10, isBinary: false };
}

function makeClassified(
	path: string,
	action: ClassifiedPath['action'],
	local: ClassifiedPath['local'] = 'unchanged',
	remote: ClassifiedPath['remote'] = 'unchanged',
): ClassifiedPath {
	return { path, action, local, remote };
}

function makeEngine(
	overrides: {
		vault?: MockVault;
		client?: MockClient;
		stateStore?: MockStateStore;
		logger?: SyncLogger;
		settings?: Settings;
		conflicts?: { resolve: Mock };
		firstSync?: { resolve: Mock };
	} = {},
) {
	const vault = overrides.vault ?? makeVault();
	const client = overrides.client ?? makeClient();
	const stateStore = overrides.stateStore ?? makeStateStore(makeState());
	const logger = overrides.logger ?? makeLogger();
	const settings = overrides.settings ?? makeSettings();
	const conflicts = overrides.conflicts ?? makeConflictResolver();
	const firstSync = overrides.firstSync ?? makeFirstSyncResolver();

	const engine = new SyncEngine(
		vault as unknown as VaultAdapter,
		client as unknown as GitHubClient,
		stateStore as unknown as StateStore,
		logger,
		() => settings,
		conflicts as unknown as ConflictResolver,
		firstSync as unknown as FirstSyncResolver,
	);

	return { engine, vault, client, stateStore, logger, settings, conflicts, firstSync };
}

// Default module mock returns for happy-path tests
function setupNoChanges() {
	vi.mocked(buildLocalChangeSet).mockResolvedValue(new Map());
	vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
	vi.mocked(classify).mockReturnValue([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Pre-flight validation
// ---------------------------------------------------------------------------

describe('pre-flight validation', () => {
	test.each([
		['missing pat', { pat: '' }],
		['missing owner', { owner: '' }],
		['missing repo', { repo: '' }],
		['missing branch', { branch: '' }],
	])('%s → error without calling any APIs', async (_label, override) => {
		const { engine, client } = makeEngine({ settings: makeSettings(override) });

		const result = await engine.sync();

		expect(result.status).toBe('error');
		expect(client.getBranch).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Sync lock
// ---------------------------------------------------------------------------

describe('sync lock', () => {
	test('already syncing: second call returns cancelled without calling any APIs', async () => {
		const { engine, stateStore } = makeEngine();
		setupNoChanges();

		// isSyncing is set synchronously before sync()'s first await, so the
		// second call immediately sees the lock before p1 runs any further awaits.
		const p1 = engine.sync();
		const result2 = await engine.sync();

		expect(result2.status).toBe('cancelled');

		await p1; // let p1 finish cleanly rather than leaving a dangling promise
		expect(stateStore.load).toHaveBeenCalledTimes(1); // called by p1 only, not by result2
	});

	test('lock released after success: subsequent call is not blocked', async () => {
		const { engine } = makeEngine();
		setupNoChanges();

		await engine.sync();
		setupNoChanges();
		const result2 = await engine.sync();

		expect(result2.status).not.toBe('cancelled');
	});

	test('lock released after error: subsequent call is not blocked', async () => {
		const { engine, stateStore } = makeEngine();

		stateStore.load.mockRejectedValue(new Error('load error'));
		const result1 = await engine.sync();
		expect(result1.status).toBe('error');

		stateStore.load.mockResolvedValue(makeState());
		setupNoChanges();
		const result2 = await engine.sync();
		expect(result2.status).not.toBe('cancelled');
	});

	test('lock released after cancel: subsequent call is not blocked', async () => {
		const { engine, conflicts } = makeEngine({
			settings: makeSettings({ conflictPolicy: 'always-ask' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(new Map([['conflict.md', makeLocalChange('conflict.md', 'modified')]]));
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map([['conflict.md', makeRemoteChange('conflict.md', 'modified')]]));
		vi.mocked(classify).mockReturnValue([conflictPath]);
		conflicts.resolve.mockResolvedValue('cancel');

		const result1 = await engine.sync();
		expect(result1.status).toBe('cancelled');

		setupNoChanges();
		const result2 = await engine.sync();
		expect(result2.status).not.toBe('cancelled');
	});
});

// ---------------------------------------------------------------------------
// Normal sync path
// ---------------------------------------------------------------------------

describe('normal sync', () => {
	test('no changes on either side → up-to-date with state saved', async () => {
		const state = makeState();
		const { engine, stateStore } = makeEngine({ stateStore: makeStateStore(state) });
		setupNoChanges();

		const result = await engine.sync();

		expect(result.status).toBe('up-to-date');
		if (result.status === 'up-to-date') {
			expect(result.report.filesAdded).toBe(0);
			expect(result.report.filesModified).toBe(0);
			expect(result.report.filesDeleted).toBe(0);
			expect(result.report.commitSha).toBeNull();
		}
		expect(stateStore.save).toHaveBeenCalled();
	});

	test('remote-only changes → pull path exercised, state saved, status success', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'remote-head' });
		const { engine, stateStore } = makeEngine({ stateStore: makeStateStore(state) });

		const remotePath = makeClassified('remote-note.md', 'pull', 'unchanged', 'added');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['remote-note.md', makeRemoteChange('remote-note.md', 'added')]]),
		);
		vi.mocked(classify).mockReturnValue([remotePath]);
		vi.mocked(applyPull).mockResolvedValue({ updatedState, skipped: [] });

		const result = await engine.sync();

		expect(applyPull).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.filesAdded).toBe(1);
			expect(result.report.filesModified).toBe(0);
			expect(result.report.commitSha).toBeNull();
		}
		// Save called after pull, then again for lastSyncCommitSha update
		expect(stateStore.save).toHaveBeenCalledTimes(2);
	});

	test('local-only changes → push path exercised, commit created, status success', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit-sha' });
		const { engine, stateStore } = makeEngine({ stateStore: makeStateStore(state) });

		const localPath = makeClassified('local-note.md', 'push', 'added', 'unchanged');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['local-note.md', makeLocalChange('local-note.md', 'added')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([localPath]);
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit-sha', updatedState });

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.filesAdded).toBe(1);
			expect(result.report.commitSha).toBe('new-commit-sha');
		}
		expect(stateStore.save).toHaveBeenCalledOnce();
	});

	test('local delete → filesDeleted incremented', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine } = makeEngine({ stateStore: makeStateStore(state) });

		const localPath = makeClassified('gone.md', 'push', 'deleted', 'unchanged');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['gone.md', makeLocalChange('gone.md', 'deleted')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([localPath]);
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.filesDeleted).toBe(1);
			expect(result.report.filesAdded).toBe(0);
		}
	});

	test('conflicts with always-prefer-local → ConflictResolver not called, conflict pushed', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, conflicts } = makeEngine({
			stateStore: makeStateStore(state),
			settings: makeSettings({ conflictPolicy: 'always-prefer-local' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeLocalChange('conflict.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeRemoteChange('conflict.md', 'modified')]]),
		);
		vi.mocked(classify).mockReturnValue([conflictPath]);
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(conflicts.resolve).not.toHaveBeenCalled();
		expect(applyPush).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.conflictsResolved).toBe(1);
		}
	});

	test('conflicts with always-prefer-remote → ConflictResolver not called, conflict pulled', async () => {
		const state = makeState();
		const updatedState = makeState();
		const { engine, conflicts } = makeEngine({
			stateStore: makeStateStore(state),
			settings: makeSettings({ conflictPolicy: 'always-prefer-remote' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeLocalChange('conflict.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeRemoteChange('conflict.md', 'modified')]]),
		);
		vi.mocked(classify).mockReturnValue([conflictPath]);
		vi.mocked(applyPull).mockResolvedValue({ updatedState, skipped: [] });

		const result = await engine.sync();

		expect(conflicts.resolve).not.toHaveBeenCalled();
		expect(applyPull).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.conflictsResolved).toBe(1);
		}
	});

	test('conflicts with always-ask, cancel → status cancelled', async () => {
		const { engine, conflicts } = makeEngine({
			settings: makeSettings({ conflictPolicy: 'always-ask' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([conflictPath]);
		conflicts.resolve.mockResolvedValue('cancel');

		const result = await engine.sync();

		expect(conflicts.resolve).toHaveBeenCalledWith([conflictPath]);
		expect(result.status).toBe('cancelled');
	});

	test('conflicts with always-ask, resolved → ConflictResolver called, resolution applied', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, conflicts } = makeEngine({
			stateStore: makeStateStore(state),
			settings: makeSettings({ conflictPolicy: 'always-ask' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeLocalChange('conflict.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeRemoteChange('conflict.md', 'modified')]]),
		);
		vi.mocked(classify).mockReturnValue([conflictPath]);
		conflicts.resolve.mockResolvedValue(new Map([['conflict.md', 'keep-local']]));
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(conflicts.resolve).toHaveBeenCalledWith([conflictPath]);
		expect(applyPush).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
	});

	test('skipped oversized files reported in result', async () => {
		const state = makeState();
		const updatedState = makeState();
		const { engine } = makeEngine({ stateStore: makeStateStore(state) });

		const pullPath = makeClassified('large.zip', 'pull', 'unchanged', 'added');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['large.zip', makeRemoteChange('large.zip', 'added')]]),
		);
		vi.mocked(classify).mockReturnValue([pullPath]);
		vi.mocked(applyPull).mockResolvedValue({ updatedState, skipped: ['large.zip'] });

		const result = await engine.sync();

		expect(result.status).toBe('up-to-date'); // file was skipped, so no filesAdded
		if (result.status === 'up-to-date') {
			expect(result.report.skippedOversized).toEqual(['large.zip']);
		}
	});
});

// ---------------------------------------------------------------------------
// GHFastForwardError retry
// ---------------------------------------------------------------------------

describe('GHFastForwardError retry', () => {
	test('one retry: success on second attempt → status success', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, client } = makeEngine({ stateStore: makeStateStore(state) });

		const pushPath = makeClassified('note.md', 'push', 'modified', 'unchanged');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['note.md', makeLocalChange('note.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([pushPath]);
		vi.mocked(applyPull).mockResolvedValue({ updatedState: state, skipped: [] });
		vi.mocked(applyPush)
			.mockRejectedValueOnce(new GHFastForwardError('ff required'))
			.mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledTimes(2);
		expect(client.getBranch).toHaveBeenCalledTimes(2);
		expect(result.status).toBe('success');
	});

	test('two retries: success on third attempt → status success', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, client } = makeEngine({ stateStore: makeStateStore(state) });

		const pushPath = makeClassified('note.md', 'push', 'modified', 'unchanged');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['note.md', makeLocalChange('note.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([pushPath]);
		vi.mocked(applyPush)
			.mockRejectedValueOnce(new GHFastForwardError('ff'))
			.mockRejectedValueOnce(new GHFastForwardError('ff'))
			.mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledTimes(3);
		expect(client.getBranch).toHaveBeenCalledTimes(3);
		expect(result.status).toBe('success');
	});

	test('GHFastForwardError × 3 → status error', async () => {
		const state = makeState();
		const { engine } = makeEngine({ stateStore: makeStateStore(state) });

		const pushPath = makeClassified('note.md', 'push', 'modified', 'unchanged');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['note.md', makeLocalChange('note.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([pushPath]);
		vi.mocked(applyPush).mockRejectedValue(new GHFastForwardError('ff'));

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledTimes(3);
		expect(result.status).toBe('error');
	});

	test('conflictsResolved not double-counted across retries', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine } = makeEngine({
			stateStore: makeStateStore(state),
			settings: makeSettings({ conflictPolicy: 'always-prefer-local' }),
		});

		const conflictPath = makeClassified('conflict.md', 'conflict', 'modified', 'modified');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeLocalChange('conflict.md', 'modified')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(
			new Map([['conflict.md', makeRemoteChange('conflict.md', 'modified')]]),
		);
		vi.mocked(classify).mockReturnValue([conflictPath]);
		vi.mocked(applyPush)
			.mockRejectedValueOnce(new GHFastForwardError('ff'))
			.mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.conflictsResolved).toBe(1); // not 2 despite two iterations
		}
	});
});

// ---------------------------------------------------------------------------
// First-sync branch
// ---------------------------------------------------------------------------

describe('first-sync', () => {
	test('empty state + non-empty remote → FirstSyncResolver called, pull executed, state saved', async () => {
		const { engine, stateStore, firstSync } = makeEngine({
			stateStore: makeStateStore(null), // no state
		});

		const remotePath = makeRemoteChange('remote.md', 'added');
		const summary: FirstSyncSummary = {
			localOnly: [],
			remoteOnly: ['remote.md'],
			identical: [],
			conflicts: [],
		};

		vi.mocked(buildLocalInventory).mockResolvedValue(new Map());
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map([['remote.md', remotePath]]));
		vi.mocked(buildFirstSyncSummary).mockResolvedValue(summary);
		firstSync.resolve.mockResolvedValue(new Map());

		const updatedState = makeState();
		vi.mocked(applyPull).mockResolvedValue({ updatedState, skipped: [] });

		const result = await engine.sync();

		expect(buildLocalInventory).toHaveBeenCalledOnce();
		expect(buildFirstSyncSummary).toHaveBeenCalledOnce();
		expect(firstSync.resolve).toHaveBeenCalledWith(summary);
		expect(applyPull).toHaveBeenCalledOnce();
		expect(stateStore.save).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.filesAdded).toBe(1);
		}
	});

	test('first-sync with local-only files → push executed', async () => {
		const { engine, stateStore, firstSync } = makeEngine({
			stateStore: makeStateStore(null),
		});

		const localChange = makeLocalChange('local.md', 'added');
		const summary: FirstSyncSummary = {
			localOnly: ['local.md'],
			remoteOnly: [],
			identical: [],
			conflicts: [],
		};

		vi.mocked(buildLocalInventory).mockResolvedValue(new Map([['local.md', localChange]]));
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildFirstSyncSummary).mockResolvedValue(summary);
		firstSync.resolve.mockResolvedValue(new Map());

		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledOnce();
		expect(stateStore.save).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.report.commitSha).toBe('new-commit');
		}
	});

	test('first-sync identical files → recorded in state directly, no network I/O', async () => {
		const { engine, stateStore, firstSync } = makeEngine({
			stateStore: makeStateStore(null),
		});

		const localChange = makeLocalChange('same.md', 'added');
		const remoteChange = makeRemoteChange('same.md', 'added');
		const summary: FirstSyncSummary = {
			localOnly: [],
			remoteOnly: [],
			identical: ['same.md'],
			conflicts: [],
		};

		vi.mocked(buildLocalInventory).mockResolvedValue(new Map([['same.md', localChange]]));
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map([['same.md', remoteChange]]));
		vi.mocked(buildFirstSyncSummary).mockResolvedValue(summary);
		firstSync.resolve.mockResolvedValue(new Map());

		const result = await engine.sync();

		expect(applyPull).not.toHaveBeenCalled();
		expect(applyPush).not.toHaveBeenCalled();
		expect(stateStore.save).toHaveBeenCalledOnce();
		// Identical file recorded in state
		const savedState = stateStore.save.mock.calls[0][0] as SyncState;
		expect(savedState.files['same.md']).toMatchObject({
			path: 'same.md',
			blobSha: remoteChange.blobSha,
			contentHash: localChange.contentHash,
		});
		expect(result.status).toBe('up-to-date');
	});

	test('first-sync GHFastForwardError → error returned, state not saved (no retry)', async () => {
		const { engine, stateStore, firstSync } = makeEngine({
			stateStore: makeStateStore(null),
		});

		const summary: FirstSyncSummary = {
			localOnly: ['local.md'],
			remoteOnly: [],
			identical: [],
			conflicts: [],
		};

		vi.mocked(buildLocalInventory).mockResolvedValue(
			new Map([['local.md', makeLocalChange('local.md')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildFirstSyncSummary).mockResolvedValue(summary);
		firstSync.resolve.mockResolvedValue(new Map());
		vi.mocked(applyPush).mockRejectedValue(new GHFastForwardError('ff'));

		const result = await engine.sync();

		expect(applyPush).toHaveBeenCalledTimes(1); // no retry in first-sync path
		expect(result.status).toBe('error');
		expect(stateStore.save).not.toHaveBeenCalled();
	});

	test('first-sync cancel → status cancelled, state not saved', async () => {
		const { engine, stateStore, firstSync } = makeEngine({
			stateStore: makeStateStore(null),
		});

		const summary: FirstSyncSummary = {
			localOnly: [],
			remoteOnly: ['conflict.md'],
			identical: [],
			conflicts: [{ path: 'conflict.md', action: 'conflict', local: 'added', remote: 'added' }],
		};

		vi.mocked(buildLocalInventory).mockResolvedValue(new Map());
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(buildFirstSyncSummary).mockResolvedValue(summary);
		firstSync.resolve.mockResolvedValue('cancel');

		const result = await engine.sync();

		expect(result.status).toBe('cancelled');
		expect(stateStore.save).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe('logging', () => {
	test('sync.start logged at beginning of every successful sync', async () => {
		const { engine, logger } = makeEngine();
		setupNoChanges();

		await engine.sync();

		expect((logger as ReturnType<typeof makeLogger>).info).toHaveBeenCalledWith('sync.start');
	});

	test('sync.error logged and error returned when unexpected exception thrown', async () => {
		const { engine, stateStore, logger } = makeEngine();
		const boom = new Error('unexpected boom');
		stateStore.load.mockRejectedValue(boom);

		const result = await engine.sync();

		expect(result.status).toBe('error');
		expect((logger as ReturnType<typeof makeLogger>).error).toHaveBeenCalledWith(
			'sync.error',
			expect.objectContaining({ error: boom.message }),
		);
	});

	test('sync.complete logged with correct fields after successful push', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, logger } = makeEngine({ stateStore: makeStateStore(state) });

		const pushPath = makeClassified('note.md', 'push', 'added');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['note.md', makeLocalChange('note.md', 'added')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([pushPath]);
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		await engine.sync();

		expect((logger as ReturnType<typeof makeLogger>).info).toHaveBeenCalledWith(
			'sync.complete',
			expect.objectContaining({ status: 'success', filesAdded: 1, filesModified: 0, filesDeleted: 0 }),
		);
	});

	test('sync.commit logged when push succeeds', async () => {
		const state = makeState();
		const updatedState = makeState({ lastSyncCommitSha: 'new-commit' });
		const { engine, logger } = makeEngine({ stateStore: makeStateStore(state) });

		const pushPath = makeClassified('note.md', 'push', 'added');
		vi.mocked(buildLocalChangeSet).mockResolvedValue(
			new Map([['note.md', makeLocalChange('note.md', 'added')]]),
		);
		vi.mocked(buildRemoteChangeSet).mockResolvedValue(new Map());
		vi.mocked(classify).mockReturnValue([pushPath]);
		vi.mocked(applyPush).mockResolvedValue({ newCommitSha: 'new-commit', updatedState });

		await engine.sync();

		expect((logger as ReturnType<typeof makeLogger>).info).toHaveBeenCalledWith(
			'sync.commit',
			{ commitSha: 'new-commit' },
		);
	});
});

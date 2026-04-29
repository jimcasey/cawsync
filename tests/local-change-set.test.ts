import { describe, test, expect } from 'vitest';
import { buildLocalChangeSet } from '../src/local-change-set';
import { sha256 } from '../src/hash';
import type { VaultAdapter } from '../src/sync-engine-types';
import type { SyncState, SyncedFileRecord } from '../src/state-store';
import type { Settings } from '../src/settings';

const BASE_STATE: SyncState = {
	schemaVersion: 1,
	lastSyncCommitSha: null,
	lastSyncAt: '2026-01-01T00:00:00Z',
	files: {},
};

const BASE_SETTINGS: Settings = {
	owner: '',
	repo: '',
	branch: 'main',
	pat: '',
	conflictPolicy: 'always-ask',
	perFileSizeLimitMb: 25,
	deviceName: '',
	includeObsidianConfig: false,
	excludePatterns: [],
	verboseLogging: false,
};

function toBytes(text: string): ArrayBuffer {
	const encoded = new TextEncoder().encode(text);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

function makeAdapter(spec: {
	listFiles?: string[];
	listDirectory?: Record<string, { files: string[]; dirs: string[] }>;
	textContent?: Record<string, string>;
	binaryContent?: Record<string, ArrayBuffer>;
	exists?: Record<string, boolean>;
}): VaultAdapter {
	return {
		listFiles: () => Promise.resolve(spec.listFiles ?? []),
		listDirectory: (path: string) =>
			Promise.resolve(spec.listDirectory?.[path] ?? { files: [], dirs: [] }),
		readText: (path: string) => Promise.resolve(spec.textContent?.[path] ?? ''),
		readBinary: (path: string) =>
			Promise.resolve(spec.binaryContent?.[path] ?? new ArrayBuffer(0)),
		exists: (path: string) => Promise.resolve(spec.exists?.[path] ?? false),
		writeText: () => Promise.resolve(),
		writeBinary: () => Promise.resolve(),
		delete: () => Promise.resolve(),
	};
}

function stateWithFiles(entries: Array<Partial<SyncedFileRecord> & { path: string; contentHash: string }>): SyncState {
	const files: Record<string, SyncedFileRecord> = {};
	for (const e of entries) {
		files[e.path] = {
			path: e.path,
			blobSha: e.blobSha ?? 'blob-sha',
			contentHash: e.contentHash,
			size: e.size ?? 10,
			isBinary: e.isBinary ?? false,
		};
	}
	return { ...BASE_STATE, files };
}

describe('buildLocalChangeSet', () => {
	test('new file not in state → added', async () => {
		const adapter = makeAdapter({
			listFiles: ['notes/hello.md'],
			textContent: { 'notes/hello.md': 'Hello world' },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, BASE_SETTINGS);

		expect(result.size).toBe(1);
		const entry = result.get('notes/hello.md');
		expect(entry?.type).toBe('added');
		expect(entry?.isBinary).toBe(false);
		expect(entry?.bytes).toBeDefined();
		expect(entry?.contentHash).toBe(await sha256(toBytes('Hello world')));
	});

	test('modified file (hash differs) → modified', async () => {
		const oldHash = await sha256(toBytes('old content'));
		const state = stateWithFiles([{ path: 'notes/hello.md', contentHash: oldHash }]);
		const adapter = makeAdapter({
			listFiles: ['notes/hello.md'],
			textContent: { 'notes/hello.md': 'new content' },
		});
		const result = await buildLocalChangeSet(adapter, state, BASE_SETTINGS);

		expect(result.size).toBe(1);
		const entry = result.get('notes/hello.md');
		expect(entry?.type).toBe('modified');
		expect(entry?.contentHash).toBe(await sha256(toBytes('new content')));
	});

	test('unmodified file (hash matches) → not in output', async () => {
		const content = 'unchanged content';
		const hash = await sha256(toBytes(content));
		const state = stateWithFiles([{ path: 'notes/hello.md', contentHash: hash }]);
		const adapter = makeAdapter({
			listFiles: ['notes/hello.md'],
			textContent: { 'notes/hello.md': content },
		});
		const result = await buildLocalChangeSet(adapter, state, BASE_SETTINGS);

		expect(result.has('notes/hello.md')).toBe(false);
		expect(result.size).toBe(0);
	});

	test('file in state but absent from vault → deleted', async () => {
		const state = stateWithFiles([{ path: 'notes/gone.md', contentHash: 'some-hash' }]);
		const adapter = makeAdapter({ listFiles: [] });
		const result = await buildLocalChangeSet(adapter, state, BASE_SETTINGS);

		expect(result.size).toBe(1);
		const entry = result.get('notes/gone.md');
		expect(entry?.type).toBe('deleted');
		expect(entry?.bytes).toBeUndefined();
		expect(entry?.contentHash).toBe('');
		expect(entry?.size).toBe(0);
	});

	test('deleted file inherits isBinary from state record', async () => {
		const state: SyncState = {
			...BASE_STATE,
			files: {
				'image.png': {
					path: 'image.png',
					blobSha: 'blob-sha',
					contentHash: 'some-hash',
					size: 1024,
					isBinary: true,
				},
			},
		};
		const adapter = makeAdapter({ listFiles: [] });
		const result = await buildLocalChangeSet(adapter, state, BASE_SETTINGS);

		expect(result.get('image.png')?.isBinary).toBe(true);
	});

	test('file matching hard-excluded path → not in output', async () => {
		const adapter = makeAdapter({
			listFiles: [
				'.obsidian/plugins/jackdaw/data.json',
				'.obsidian/plugins/jackdaw/sync-state.json',
				'.obsidian/plugins/jackdaw/sync.log',
				'notes.md',
			],
			textContent: { 'notes.md': 'hi' },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, BASE_SETTINGS);

		expect(result.has('.obsidian/plugins/jackdaw/data.json')).toBe(false);
		expect(result.has('.obsidian/plugins/jackdaw/sync-state.json')).toBe(false);
		expect(result.has('.obsidian/plugins/jackdaw/sync.log')).toBe(false);
		expect(result.has('notes.md')).toBe(true);
	});

	test('file matching user exclude pattern → not in output', async () => {
		const settings = { ...BASE_SETTINGS, excludePatterns: ['*.tmp', '.DS_Store'] };
		const adapter = makeAdapter({
			listFiles: ['notes.md', 'scratch.tmp', '.DS_Store'],
			textContent: { 'notes.md': 'hi', 'scratch.tmp': 'temp', '.DS_Store': 'meta' },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, settings);

		expect(result.has('notes.md')).toBe(true);
		expect(result.has('scratch.tmp')).toBe(false);
		expect(result.has('.DS_Store')).toBe(false);
	});

	test('plugin self-excluded files excluded even when includeObsidianConfig is true', async () => {
		const settings = { ...BASE_SETTINGS, includeObsidianConfig: true };
		const adapter = makeAdapter({
			listFiles: [],
			exists: { '.gitignore': false },
			listDirectory: {
				'.obsidian': { files: [], dirs: ['plugins'] },
				'.obsidian/plugins': { files: [], dirs: ['jackdaw'] },
				'.obsidian/plugins/jackdaw': {
					files: ['data.json', 'sync-state.json', 'sync.log', 'main.js'],
					dirs: [],
				},
			},
			textContent: { '.obsidian/plugins/jackdaw/main.js': 'plugin code' },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, settings);

		expect(result.has('.obsidian/plugins/jackdaw/data.json')).toBe(false);
		expect(result.has('.obsidian/plugins/jackdaw/sync-state.json')).toBe(false);
		expect(result.has('.obsidian/plugins/jackdaw/sync.log')).toBe(false);
		// main.js is not self-excluded and should appear
		expect(result.has('.obsidian/plugins/jackdaw/main.js')).toBe(true);
	});

	test('binary file detected by extension and read via readBinary', async () => {
		const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
		const adapter = makeAdapter({
			listFiles: ['photo.png'],
			binaryContent: { 'photo.png': imageBytes },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, BASE_SETTINGS);

		const entry = result.get('photo.png');
		expect(entry?.type).toBe('added');
		expect(entry?.isBinary).toBe(true);
		expect(entry?.bytes).toBeDefined();
	});

	test('multiple files: mix of added, modified, unchanged, and deleted', async () => {
		const unchangedContent = 'unchanged';
		const unchangedHash = await sha256(toBytes(unchangedContent));
		const oldHash = await sha256(toBytes('old'));

		const state = stateWithFiles([
			{ path: 'unchanged.md', contentHash: unchangedHash },
			{ path: 'modified.md', contentHash: oldHash },
			{ path: 'deleted.md', contentHash: 'some-hash' },
		]);

		const adapter = makeAdapter({
			listFiles: ['unchanged.md', 'modified.md', 'new.md'],
			textContent: {
				'unchanged.md': unchangedContent,
				'modified.md': 'new content',
				'new.md': 'brand new',
			},
		});

		const result = await buildLocalChangeSet(adapter, state, BASE_SETTINGS);

		expect(result.has('unchanged.md')).toBe(false);
		expect(result.get('modified.md')?.type).toBe('modified');
		expect(result.get('new.md')?.type).toBe('added');
		expect(result.get('deleted.md')?.type).toBe('deleted');
		expect(result.size).toBe(3);
	});

	test('file exceeding perFileSizeLimitMb is skipped', async () => {
		const settings = { ...BASE_SETTINGS, perFileSizeLimitMb: 0.000001 }; // ~1 byte limit
		const adapter = makeAdapter({
			listFiles: ['big.md', 'small.md'],
			textContent: { 'big.md': 'this is definitely more than one byte', 'small.md': 'x' },
		});
		const result = await buildLocalChangeSet(adapter, BASE_STATE, settings);

		expect(result.has('big.md')).toBe(false);
		expect(result.has('small.md')).toBe(true);
	});

	test('oversized file in state is not marked deleted — it is skipped silently', async () => {
		const settings = { ...BASE_SETTINGS, perFileSizeLimitMb: 0.000001 };
		const state = stateWithFiles([{ path: 'big.md', contentHash: 'old-hash' }]);
		const adapter = makeAdapter({
			listFiles: ['big.md'],
			textContent: { 'big.md': 'this is definitely more than one byte' },
		});
		const result = await buildLocalChangeSet(adapter, state, settings);

		// Over-limit files are silently excluded, not treated as deletions
		expect(result.has('big.md')).toBe(false);
		expect(result.size).toBe(0);
	});
});

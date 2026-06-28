import { describe, test, expect } from 'vitest';
import { buildLocalInventory, buildFirstSyncSummary } from '../src/first-sync';
import { sha256, gitBlobSha1 } from '../src/hash';
import type { VaultAdapter, LocalChange, RemoteChange } from '../src/sync-engine-types';
import type { Settings } from '../src/settings';

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

function remoteEntry(path: string, blobSha: string, size = 0, isBinary = false): RemoteChange {
	return { path, type: 'added', blobSha, size, isBinary };
}

async function localEntry(path: string, bytes: ArrayBuffer, isBinary = false): Promise<LocalChange> {
	return { path, type: 'added', contentHash: await sha256(bytes), bytes, size: bytes.byteLength, isBinary };
}

describe('buildLocalInventory', () => {
	test('returns all vault files with bytes and contentHash', async () => {
		const content = 'Hello, world!';
		const adapter = makeAdapter({
			listFiles: ['notes/hello.md'],
			textContent: { 'notes/hello.md': content },
		});
		const result = await buildLocalInventory(adapter, BASE_SETTINGS);

		expect(result.size).toBe(1);
		const entry = result.get('notes/hello.md');
		expect(entry?.type).toBe('added');
		expect(entry?.bytes).toBeDefined();
		expect(entry?.contentHash).toBe(await sha256(toBytes(content)));
	});

	test('all returned entries have type "added"', async () => {
		const adapter = makeAdapter({
			listFiles: ['a.md', 'b.md'],
			textContent: { 'a.md': 'A', 'b.md': 'B' },
		});
		const result = await buildLocalInventory(adapter, BASE_SETTINGS);

		for (const entry of result.values()) {
			expect(entry.type).toBe('added');
		}
	});

	test('oversized files are skipped', async () => {
		const settings = { ...BASE_SETTINGS, perFileSizeLimitMb: 0.000001 };
		const adapter = makeAdapter({
			listFiles: ['big.md', 'small.md'],
			textContent: { 'big.md': 'this is more than one byte', 'small.md': 'x' },
		});
		const result = await buildLocalInventory(adapter, settings);

		expect(result.has('big.md')).toBe(false);
		expect(result.has('small.md')).toBe(true);
	});

	test('self-excluded plugin files are excluded', async () => {
		const adapter = makeAdapter({
			listFiles: [
				'.obsidian/plugins/cawsync/data.json',
				'.obsidian/plugins/cawsync/sync-state.json',
				'notes.md',
			],
			textContent: { 'notes.md': 'hi' },
		});
		const result = await buildLocalInventory(adapter, BASE_SETTINGS);

		expect(result.has('.obsidian/plugins/cawsync/data.json')).toBe(false);
		expect(result.has('.obsidian/plugins/cawsync/sync-state.json')).toBe(false);
		expect(result.has('notes.md')).toBe(true);
	});

	test('binary file detected by extension and read via readBinary', async () => {
		const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
		const adapter = makeAdapter({
			listFiles: ['photo.png'],
			binaryContent: { 'photo.png': imageBytes },
		});
		const result = await buildLocalInventory(adapter, BASE_SETTINGS);

		const entry = result.get('photo.png');
		expect(entry?.isBinary).toBe(true);
		expect(entry?.bytes).toBeDefined();
	});

	test('file matching user exclude pattern → not in output', async () => {
		const settings = { ...BASE_SETTINGS, excludePatterns: ['*.tmp', '.DS_Store'] };
		const adapter = makeAdapter({
			listFiles: ['notes.md', 'scratch.tmp', '.DS_Store'],
			textContent: { 'notes.md': 'hi', 'scratch.tmp': 'temp', '.DS_Store': 'meta' },
		});
		const result = await buildLocalInventory(adapter, settings);

		expect(result.has('notes.md')).toBe(true);
		expect(result.has('scratch.tmp')).toBe(false);
		expect(result.has('.DS_Store')).toBe(false);
	});
});

describe('buildFirstSyncSummary', () => {
	test('path only in local → localOnly', async () => {
		const bytes = toBytes('local content');
		const localInventory = new Map<string, LocalChange>([
			['notes/local.md', await localEntry('notes/local.md', bytes)],
		]);
		const remoteTree = new Map<string, RemoteChange>();

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.localOnly).toEqual(['notes/local.md']);
		expect(summary.remoteOnly).toHaveLength(0);
		expect(summary.identical).toHaveLength(0);
		expect(summary.conflicts).toHaveLength(0);
	});

	test('path only in remote → remoteOnly', async () => {
		const localInventory = new Map<string, LocalChange>();
		const remoteTree = new Map<string, RemoteChange>([
			['notes/remote.md', remoteEntry('notes/remote.md', 'abc123')],
		]);

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.remoteOnly).toEqual(['notes/remote.md']);
		expect(summary.localOnly).toHaveLength(0);
		expect(summary.identical).toHaveLength(0);
		expect(summary.conflicts).toHaveLength(0);
	});

	test('path on both sides with matching git blob SHA → identical', async () => {
		const bytes = toBytes('same content');
		const blobSha = await gitBlobSha1(bytes);
		const localInventory = new Map<string, LocalChange>([
			['notes/shared.md', await localEntry('notes/shared.md', bytes)],
		]);
		const remoteTree = new Map<string, RemoteChange>([
			['notes/shared.md', remoteEntry('notes/shared.md', blobSha)],
		]);

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.identical).toEqual(['notes/shared.md']);
		expect(summary.localOnly).toHaveLength(0);
		expect(summary.remoteOnly).toHaveLength(0);
		expect(summary.conflicts).toHaveLength(0);
	});

	test('path on both sides with differing git blob SHA → conflict', async () => {
		const localBytes = toBytes('local version');
		const localInventory = new Map<string, LocalChange>([
			['notes/conflict.md', await localEntry('notes/conflict.md', localBytes)],
		]);
		const remoteTree = new Map<string, RemoteChange>([
			['notes/conflict.md', remoteEntry('notes/conflict.md', 'different-blob-sha')],
		]);

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.conflicts).toHaveLength(1);
		expect(summary.conflicts[0].path).toBe('notes/conflict.md');
		expect(summary.conflicts[0].action).toBe('conflict');
		expect(summary.conflicts[0].local).toBe('added');
		expect(summary.conflicts[0].remote).toBe('added');
		expect(summary.localOnly).toHaveLength(0);
		expect(summary.remoteOnly).toHaveLength(0);
		expect(summary.identical).toHaveLength(0);
	});

	test('mixed vault: all four categories in one call', async () => {
		const localBytes = toBytes('local only');
		const sharedBytes = toBytes('shared content');
		const sharedBlobSha = await gitBlobSha1(sharedBytes);
		const conflictBytes = toBytes('local conflict version');

		const localInventory = new Map<string, LocalChange>([
			['local.md', await localEntry('local.md', localBytes)],
			['shared.md', await localEntry('shared.md', sharedBytes)],
			['conflict.md', await localEntry('conflict.md', conflictBytes)],
		]);
		const remoteTree = new Map<string, RemoteChange>([
			['remote.md', remoteEntry('remote.md', 'remote-blob-sha')],
			['shared.md', remoteEntry('shared.md', sharedBlobSha)],
			['conflict.md', remoteEntry('conflict.md', 'different-blob-sha')],
		]);

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.localOnly).toEqual(['local.md']);
		expect(summary.remoteOnly).toEqual(['remote.md']);
		expect(summary.identical).toEqual(['shared.md']);
		expect(summary.conflicts).toHaveLength(1);
		expect(summary.conflicts[0].path).toBe('conflict.md');
	});

	test('empty local and empty remote → all arrays empty', async () => {
		const summary = await buildFirstSyncSummary(
			new Map<string, LocalChange>(),
			new Map<string, RemoteChange>(),
		);

		expect(summary.localOnly).toHaveLength(0);
		expect(summary.remoteOnly).toHaveLength(0);
		expect(summary.identical).toHaveLength(0);
		expect(summary.conflicts).toHaveLength(0);
	});

	test('remote entry with undefined blobSha → conflict', async () => {
		const bytes = toBytes('some content');
		const localInventory = new Map<string, LocalChange>([
			['notes/file.md', await localEntry('notes/file.md', bytes)],
		]);
		const remoteTree = new Map<string, RemoteChange>([
			['notes/file.md', { path: 'notes/file.md', type: 'added', blobSha: undefined, size: 0, isBinary: false }],
		]);

		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		expect(summary.conflicts).toHaveLength(1);
		expect(summary.conflicts[0].path).toBe('notes/file.md');
		expect(summary.identical).toHaveLength(0);
	});
});

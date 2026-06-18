import { describe, test, expect } from 'vitest';
import {
	InMemoryStateAdapter,
	InMemoryVaultAdapter,
} from './integration/in-memory-adapters';

describe('InMemoryVaultAdapter', () => {
	test('writeText then readText round-trips', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('notes/a.md', 'hello');
		expect(await vault.readText('notes/a.md')).toBe('hello');
	});

	test('writeBinary then readBinary preserves bytes', async () => {
		const vault = new InMemoryVaultAdapter();
		const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
		await vault.writeBinary('img.bin', bytes);
		const back = new Uint8Array(await vault.readBinary('img.bin'));
		expect([...back]).toEqual([1, 2, 3, 4]);
	});

	test('readText throws when path is missing', async () => {
		const vault = new InMemoryVaultAdapter();
		await expect(vault.readText('missing.md')).rejects.toThrow(/File not found/);
	});

	test('exists reflects writes and deletes', async () => {
		const vault = new InMemoryVaultAdapter();
		expect(await vault.exists('a.md')).toBe(false);
		await vault.writeText('a.md', 'x');
		expect(await vault.exists('a.md')).toBe(true);
		await vault.delete('a.md');
		expect(await vault.exists('a.md')).toBe(false);
	});

	test('listFiles returns every written path', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('a.md', '');
		await vault.writeText('b/c.md', '');
		expect((await vault.listFiles()).sort()).toEqual(['a.md', 'b/c.md']);
	});

	test('listDirectory returns immediate files and dirs by basename', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('.obsidian/app.json', '{}');
		await vault.writeText('.obsidian/plugins/foo/main.js', '');
		await vault.writeText('.obsidian/snippets/x.css', '');

		const top = await vault.listDirectory('.obsidian');
		expect(top.files.sort()).toEqual(['app.json']);
		expect(top.dirs.sort()).toEqual(['plugins', 'snippets']);

		const plugins = await vault.listDirectory('.obsidian/plugins');
		expect(plugins.files).toEqual([]);
		expect(plugins.dirs).toEqual(['foo']);
	});

	test('listDirectory tolerates a trailing slash on the input path', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('dir/a.md', '');
		const listing = await vault.listDirectory('dir/');
		expect(listing.files).toEqual(['a.md']);
	});

	test('snapshotPaths returns sorted paths', async () => {
		const vault = new InMemoryVaultAdapter();
		await vault.writeText('z.md', '');
		await vault.writeText('a.md', '');
		expect(vault.snapshotPaths()).toEqual(['a.md', 'z.md']);
	});
});

describe('InMemoryStateAdapter', () => {
	test('write then read round-trips', async () => {
		const state = new InMemoryStateAdapter();
		await state.write('p', 'data');
		expect(await state.read('p')).toBe('data');
	});

	test('read throws when missing', async () => {
		const state = new InMemoryStateAdapter();
		await expect(state.read('missing')).rejects.toThrow(/Not found/);
	});

	test('rename moves data and clears the source key', async () => {
		const state = new InMemoryStateAdapter();
		await state.write('a.tmp', 'payload');
		await state.rename('a.tmp', 'a');
		expect(await state.exists('a.tmp')).toBe(false);
		expect(await state.read('a')).toBe('payload');
	});

	test('rename throws when source missing', async () => {
		const state = new InMemoryStateAdapter();
		await expect(state.rename('nope', 'somewhere')).rejects.toThrow(/Not found/);
	});

	test('remove is idempotent', async () => {
		const state = new InMemoryStateAdapter();
		await state.remove('never-existed');
		await state.write('p', 'x');
		await state.remove('p');
		expect(await state.exists('p')).toBe(false);
	});

	test('supports the StateStore atomic-write sequence', async () => {
		// Mirrors StateStore.save: write tmp, remove canonical if present, rename tmp → canonical.
		const state = new InMemoryStateAdapter();
		await state.write('sync-state.json', '{"old":1}');
		await state.write('sync-state.json.tmp', '{"new":1}');
		if (await state.exists('sync-state.json')) {
			await state.remove('sync-state.json');
		}
		await state.rename('sync-state.json.tmp', 'sync-state.json');
		expect(await state.read('sync-state.json')).toBe('{"new":1}');
		expect(await state.exists('sync-state.json.tmp')).toBe(false);
	});
});

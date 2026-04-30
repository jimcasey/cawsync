import { describe, test, expect, vi } from 'vitest';
import { ObsidianStateAdapter } from '../src/obsidian-state-adapter';
import type { DataAdapter } from 'obsidian';

function makeDataAdapter(): DataAdapter {
	return {
		exists: vi.fn(),
		read: vi.fn(),
		write: vi.fn(),
		rename: vi.fn(),
	} as unknown as DataAdapter;
}

describe('ObsidianStateAdapter', () => {
	test('exists returns true when adapter returns true', async () => {
		const da = makeDataAdapter();
		vi.mocked(da.exists).mockResolvedValue(true);
		const adapter = new ObsidianStateAdapter(da);
		expect(await adapter.exists('some/path')).toBe(true);
		expect(da.exists).toHaveBeenCalledWith('some/path');
	});

	test('exists returns false when adapter returns false', async () => {
		const da = makeDataAdapter();
		vi.mocked(da.exists).mockResolvedValue(false);
		const adapter = new ObsidianStateAdapter(da);
		expect(await adapter.exists('some/path')).toBe(false);
	});

	test('read returns the adapter value', async () => {
		const da = makeDataAdapter();
		vi.mocked(da.read).mockResolvedValue('content');
		const adapter = new ObsidianStateAdapter(da);
		expect(await adapter.read('some/path')).toBe('content');
		expect(da.read).toHaveBeenCalledWith('some/path');
	});

	test('write forwards path and data unchanged', async () => {
		const da = makeDataAdapter();
		vi.mocked(da.write).mockResolvedValue();
		const adapter = new ObsidianStateAdapter(da);
		await adapter.write('some/path', 'data');
		expect(da.write).toHaveBeenCalledWith('some/path', 'data');
	});

	test('rename forwards from and to unchanged', async () => {
		const da = makeDataAdapter();
		vi.mocked(da.rename).mockResolvedValue();
		const adapter = new ObsidianStateAdapter(da);
		await adapter.rename('old/path', 'new/path');
		expect(da.rename).toHaveBeenCalledWith('old/path', 'new/path');
	});
});

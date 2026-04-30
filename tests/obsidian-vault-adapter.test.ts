import { describe, test, expect, vi } from 'vitest';
import { ObsidianVaultAdapter } from '../src/obsidian-vault-adapter';
import type { App } from 'obsidian';

// Duck-type TFile: any object with an 'extension' field satisfies isTFile.
function mockTFile(path: string) {
	return { path, extension: 'md', name: path.split('/').pop()!, basename: path };
}

interface AppStub {
	vault: {
		getFiles: ReturnType<typeof vi.fn>;
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		readBinary: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		createBinary: ReturnType<typeof vi.fn>;
		modify: ReturnType<typeof vi.fn>;
		modifyBinary: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
		adapter: {
			list: ReturnType<typeof vi.fn>;
			read: ReturnType<typeof vi.fn>;
			readBinary: ReturnType<typeof vi.fn>;
			write: ReturnType<typeof vi.fn>;
			writeBinary: ReturnType<typeof vi.fn>;
			remove: ReturnType<typeof vi.fn>;
			exists: ReturnType<typeof vi.fn>;
		};
	};
}

function makeApp(tFiles: Record<string, ReturnType<typeof mockTFile>> = {}): AppStub {
	return {
		vault: {
			getFiles: vi.fn().mockReturnValue([]),
			getAbstractFileByPath: vi.fn((path: string) => tFiles[path] ?? null),
			read: vi.fn().mockResolvedValue('vault-text'),
			readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
			create: vi.fn().mockResolvedValue({}),
			createBinary: vi.fn().mockResolvedValue({}),
			modify: vi.fn().mockResolvedValue(undefined),
			modifyBinary: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			adapter: {
				list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
				read: vi.fn().mockResolvedValue('adapter-text'),
				readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
				write: vi.fn().mockResolvedValue(undefined),
				writeBinary: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				exists: vi.fn().mockResolvedValue(false),
			},
		},
	};
}

describe('ObsidianVaultAdapter', () => {
	describe('listFiles', () => {
		test('returns path of each vault file', async () => {
			const app = makeApp();
			app.vault.getFiles.mockReturnValue([
				{ path: 'notes/hello.md' },
				{ path: 'image.png' },
			]);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			expect(await adapter.listFiles()).toEqual(['notes/hello.md', 'image.png']);
		});
	});

	describe('listDirectory', () => {
		test('maps adapter.list folders to dirs', async () => {
			const app = makeApp();
			app.vault.adapter.list.mockResolvedValue({
				files: ['app.json', 'workspace.json'],
				folders: ['plugins', 'snippets'],
			});
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			expect(await adapter.listDirectory('.obsidian')).toEqual({
				files: ['app.json', 'workspace.json'],
				dirs: ['plugins', 'snippets'],
			});
			expect(app.vault.adapter.list).toHaveBeenCalledWith('.obsidian');
		});
	});

	describe('readText', () => {
		test('uses vault.read when TFile exists', async () => {
			const tf = mockTFile('notes/hello.md');
			const app = makeApp({ 'notes/hello.md': tf });
			app.vault.read.mockResolvedValue('vault content');
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			const result = await adapter.readText('notes/hello.md');
			expect(result).toBe('vault content');
			expect(app.vault.read).toHaveBeenCalledWith(tf);
			expect(app.vault.adapter.read).not.toHaveBeenCalled();
		});

		test('falls back to adapter.read when no TFile exists', async () => {
			const app = makeApp();
			app.vault.adapter.read.mockResolvedValue('adapter content');
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			const result = await adapter.readText('.gitignore');
			expect(result).toBe('adapter content');
			expect(app.vault.adapter.read).toHaveBeenCalledWith('.gitignore');
			expect(app.vault.read).not.toHaveBeenCalled();
		});
	});

	describe('readBinary', () => {
		test('uses vault.readBinary when TFile exists', async () => {
			const tf = mockTFile('image.png');
			const app = makeApp({ 'image.png': tf });
			const buf = new ArrayBuffer(16);
			app.vault.readBinary.mockResolvedValue(buf);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			const result = await adapter.readBinary('image.png');
			expect(result).toBe(buf);
			expect(app.vault.readBinary).toHaveBeenCalledWith(tf);
			expect(app.vault.adapter.readBinary).not.toHaveBeenCalled();
		});

		test('falls back to adapter.readBinary when no TFile exists', async () => {
			const app = makeApp();
			const buf = new ArrayBuffer(8);
			app.vault.adapter.readBinary.mockResolvedValue(buf);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			const result = await adapter.readBinary('.obsidian/app.json');
			expect(result).toBe(buf);
			expect(app.vault.adapter.readBinary).toHaveBeenCalledWith('.obsidian/app.json');
			expect(app.vault.readBinary).not.toHaveBeenCalled();
		});
	});

	describe('writeText', () => {
		test('calls vault.create on a non-existent path', async () => {
			const app = makeApp();
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeText('new-note.md', 'hello');
			expect(app.vault.create).toHaveBeenCalledWith('new-note.md', 'hello');
			expect(app.vault.modify).not.toHaveBeenCalled();
		});

		test('calls vault.modify on an existing TFile', async () => {
			const tf = mockTFile('existing.md');
			const app = makeApp({ 'existing.md': tf });
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeText('existing.md', 'updated');
			expect(app.vault.modify).toHaveBeenCalledWith(tf, 'updated');
			expect(app.vault.create).not.toHaveBeenCalled();
		});

		test('falls back to adapter.write when vault.create throws (dotfile)', async () => {
			const app = makeApp();
			app.vault.create.mockRejectedValue(new Error('not allowed'));
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeText('.obsidian/app.json', '{}');
			expect(app.vault.create).toHaveBeenCalledWith('.obsidian/app.json', '{}');
			expect(app.vault.adapter.write).toHaveBeenCalledWith('.obsidian/app.json', '{}');
		});
	});

	describe('writeBinary', () => {
		test('calls vault.createBinary on a non-existent path', async () => {
			const app = makeApp();
			const buf = new ArrayBuffer(4);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeBinary('image.png', buf);
			expect(app.vault.createBinary).toHaveBeenCalledWith('image.png', buf);
			expect(app.vault.modifyBinary).not.toHaveBeenCalled();
		});

		test('calls vault.modifyBinary on an existing TFile', async () => {
			const tf = mockTFile('image.png');
			const app = makeApp({ 'image.png': tf });
			const buf = new ArrayBuffer(4);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeBinary('image.png', buf);
			expect(app.vault.modifyBinary).toHaveBeenCalledWith(tf, buf);
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});

		test('falls back to adapter.writeBinary when vault.createBinary throws (dotfile)', async () => {
			const app = makeApp();
			app.vault.createBinary.mockRejectedValue(new Error('not allowed'));
			const buf = new ArrayBuffer(4);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.writeBinary('.obsidian/image.png', buf);
			expect(app.vault.createBinary).toHaveBeenCalledWith('.obsidian/image.png', buf);
			expect(app.vault.adapter.writeBinary).toHaveBeenCalledWith('.obsidian/image.png', buf);
		});
	});

	describe('delete', () => {
		test('calls vault.delete when TFile exists', async () => {
			const tf = mockTFile('notes/old.md');
			const app = makeApp({ 'notes/old.md': tf });
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.delete('notes/old.md');
			expect(app.vault.delete).toHaveBeenCalledWith(tf, true);
			expect(app.vault.adapter.remove).not.toHaveBeenCalled();
		});

		test('falls back to adapter.remove when no TFile exists', async () => {
			const app = makeApp();
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			await adapter.delete('.obsidian/workspace.json');
			expect(app.vault.adapter.remove).toHaveBeenCalledWith('.obsidian/workspace.json');
			expect(app.vault.delete).not.toHaveBeenCalled();
		});
	});

	describe('exists', () => {
		test('delegates to adapter.exists', async () => {
			const app = makeApp();
			app.vault.adapter.exists.mockResolvedValue(true);
			const adapter = new ObsidianVaultAdapter(app as unknown as App);
			expect(await adapter.exists('notes/hello.md')).toBe(true);
			expect(app.vault.adapter.exists).toHaveBeenCalledWith('notes/hello.md');
		});
	});
});

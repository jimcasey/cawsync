import type { App, TFile } from 'obsidian';
import type { VaultAdapter } from './sync-engine-types';

function isTFile(file: unknown): file is TFile {
	return file != null && 'extension' in (file as object);
}

export class ObsidianVaultAdapter implements VaultAdapter {
	constructor(private readonly app: App) {}

	listFiles(): Promise<string[]> {
		return Promise.resolve(this.app.vault.getFiles().map(f => f.path));
	}

	listDirectory(path: string): Promise<{ files: string[]; dirs: string[] }> {
		return this.app.vault.adapter
			.list(path)
			.then(({ files, folders }) => ({ files, dirs: folders }));
	}

	async readText(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file)) {
			return this.app.vault.read(file);
		}
		return this.app.vault.adapter.read(path);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file)) {
			return this.app.vault.readBinary(file);
		}
		return this.app.vault.adapter.readBinary(path);
	}

	async writeText(path: string, content: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file)) {
			return this.app.vault.modify(file, content);
		}
		// vault.create fires Obsidian's file-created event for indexed paths.
		// Dotfiles (.obsidian/...) aren't vault-managed, so create throws — fall back to adapter.
		try {
			await this.app.vault.create(path, content);
		} catch {
			await this.app.vault.adapter.write(path, content);
		}
	}

	async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file)) {
			return this.app.vault.modifyBinary(file, content);
		}
		// Same dotfile fallback as writeText.
		try {
			await this.app.vault.createBinary(path, content);
		} catch {
			await this.app.vault.adapter.writeBinary(path, content);
		}
	}

	async delete(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file)) {
			return this.app.vault.delete(file, true);
		}
		return this.app.vault.adapter.remove(path);
	}

	exists(path: string): Promise<boolean> {
		return this.app.vault.adapter.exists(path);
	}
}

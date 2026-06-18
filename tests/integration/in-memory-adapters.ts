// Pure-Node test doubles for the engine's VaultAdapter and StateAdapter
// interfaces. Kept free of any obsidian import so they can be unit-tested
// under the regular `npm test` config without the integration alias.

import type { VaultAdapter } from '../../src/sync-engine-types';
import type { StateAdapter } from '../../src/state-store';

export class InMemoryVaultAdapter implements VaultAdapter {
	private readonly files = new Map<string, ArrayBuffer>();

	listFiles(): Promise<string[]> {
		return Promise.resolve([...this.files.keys()]);
	}

	listDirectory(path: string): Promise<{ files: string[]; dirs: string[] }> {
		const prefix = path === '' ? '' : `${path.replace(/\/$/, '')}/`;
		const files = new Set<string>();
		const dirs = new Set<string>();
		for (const filePath of this.files.keys()) {
			if (!filePath.startsWith(prefix)) continue;
			const rest = filePath.slice(prefix.length);
			const slashIdx = rest.indexOf('/');
			if (slashIdx === -1) {
				files.add(rest);
			} else {
				dirs.add(rest.slice(0, slashIdx));
			}
		}
		return Promise.resolve({ files: [...files], dirs: [...dirs] });
	}

	async readText(path: string): Promise<string> {
		const buf = this.files.get(path);
		if (!buf) throw new Error(`File not found: ${path}`);
		return new TextDecoder().decode(buf);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const buf = this.files.get(path);
		if (!buf) throw new Error(`File not found: ${path}`);
		return buf;
	}

	async writeText(path: string, content: string): Promise<void> {
		const encoded = new TextEncoder().encode(content);
		this.files.set(
			path,
			encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
		);
	}

	async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
		this.files.set(path, content);
	}

	async delete(path: string): Promise<void> {
		this.files.delete(path);
	}

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path));
	}

	snapshotPaths(): string[] {
		return [...this.files.keys()].sort();
	}
}

export class InMemoryStateAdapter implements StateAdapter {
	private readonly entries = new Map<string, string>();

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.entries.has(path));
	}

	async read(path: string): Promise<string> {
		const v = this.entries.get(path);
		if (v === undefined) throw new Error(`Not found: ${path}`);
		return v;
	}

	async write(path: string, data: string): Promise<void> {
		this.entries.set(path, data);
	}

	async rename(from: string, to: string): Promise<void> {
		const v = this.entries.get(from);
		if (v === undefined) throw new Error(`Not found: ${from}`);
		this.entries.delete(from);
		this.entries.set(to, v);
	}

	async remove(path: string): Promise<void> {
		this.entries.delete(path);
	}
}

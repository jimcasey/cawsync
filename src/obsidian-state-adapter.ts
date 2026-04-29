import type { DataAdapter } from 'obsidian';
import type { StateAdapter } from './state-store';

export class ObsidianStateAdapter implements StateAdapter {
	constructor(private readonly adapter: DataAdapter) {}

	exists(path: string): Promise<boolean> {
		return this.adapter.exists(path);
	}

	read(path: string): Promise<string> {
		return this.adapter.read(path);
	}

	write(path: string, data: string): Promise<void> {
		return this.adapter.write(path, data);
	}

	rename(from: string, to: string): Promise<void> {
		return this.adapter.rename(from, to);
	}
}

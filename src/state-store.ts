export interface SyncedFileRecord {
	path: string;
	blobSha: string;
	contentHash: string;
	size: number;
	isBinary: boolean;
}

export interface SyncState {
	schemaVersion: 1;
	lastSyncCommitSha: string | null;
	lastSyncAt: string;
	files: Record<string, SyncedFileRecord>;
}

export const SCHEMA_VERSION = 1 as const;

export interface Logger {
	info(event: string, data?: Record<string, unknown>): Promise<void>;
	warn(event: string, data?: Record<string, unknown>): Promise<void>;
}

export interface StateAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export class StateStore {
	private readonly canonicalPath: string;
	private readonly tmpPath: string;

	constructor(
		private readonly adapter: StateAdapter,
		pluginFolder: string,
		private readonly logger: Logger,
		private readonly pretty = false,
	) {
		this.canonicalPath = `${pluginFolder}/sync-state.json`;
		this.tmpPath = `${pluginFolder}/sync-state.json.tmp`;
	}

	async load(): Promise<SyncState | null> {
		const canonicalExists = await this.adapter.exists(this.canonicalPath);
		const tmpExists = await this.adapter.exists(this.tmpPath);

		if (!canonicalExists && !tmpExists) {
			return null;
		}

		let raw: string;
		if (!canonicalExists && tmpExists) {
			try {
				raw = await this.adapter.read(this.tmpPath);
			} catch {
				await this.logger.warn('state.corrupt', { reason: 'read-error' });
				return null;
			}
			await this.logger.info('state.recover', { path: this.tmpPath });
			await this.adapter.rename(this.tmpPath, this.canonicalPath);
		} else {
			try {
				raw = await this.adapter.read(this.canonicalPath);
			} catch {
				await this.logger.warn('state.corrupt', { reason: 'read-error' });
				return null;
			}
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			await this.logger.warn('state.corrupt', { reason: 'invalid-json' });
			return null;
		}

		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			await this.logger.warn('state.corrupt', { reason: 'not-an-object' });
			return null;
		}

		const obj = parsed as Record<string, unknown>;
		if (obj['schemaVersion'] !== SCHEMA_VERSION) {
			await this.logger.warn('state.schema-mismatch', {
				expected: SCHEMA_VERSION,
				found: obj['schemaVersion'],
			});
			return null;
		}

		return obj as unknown as SyncState;
	}

	async save(state: SyncState): Promise<void> {
		const json = this.pretty ? JSON.stringify(state, null, 2) : JSON.stringify(state);
		await this.adapter.write(this.tmpPath, json);
		// Obsidian's DataAdapter.rename throws "Destination file already exists!"
		// if the destination is present, so clear it first. The load() recovery
		// path covers the window where tmp exists but canonical does not.
		if (await this.adapter.exists(this.canonicalPath)) {
			await this.adapter.remove(this.canonicalPath);
		}
		await this.adapter.rename(this.tmpPath, this.canonicalPath);
	}
}

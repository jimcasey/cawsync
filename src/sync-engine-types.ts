export type LocalChangeType = 'added' | 'modified' | 'deleted' | 'unchanged';
export type RemoteChangeType = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface LocalChange {
	path: string;
	type: LocalChangeType;
	contentHash: string;
	bytes: ArrayBuffer;
	size: number;
	isBinary: boolean;
}

export interface RemoteChange {
	path: string;
	type: RemoteChangeType;
	blobSha: string;
	size: number;
	isBinary: boolean;
}

export interface ClassifiedPath {
	path: string;
	local: LocalChangeType;
	remote: RemoteChangeType;
}

export interface ConflictItem extends ClassifiedPath {}

export interface FirstSyncSummary {
	localOnly: string[];
	remoteOnly: string[];
	identical: string[];
	conflicts: ConflictItem[];
}

export interface SyncReport {
	filesAdded: number;
	filesModified: number;
	filesDeleted: number;
	conflictsResolved: number;
	skippedOversized: string[];
	commitSha: string | null;
	durationMs: number;
}

export type SyncResult =
	| { status: 'success'; report: SyncReport }
	| { status: 'up-to-date'; report: SyncReport }
	| { status: 'cancelled' }
	| { status: 'error'; error: Error };

export interface VaultAdapter {
	listFiles(): Promise<string[]>;
	listDirectory(path: string): Promise<{ files: string[]; dirs: string[] }>;
	readText(path: string): Promise<string>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeText(path: string, content: string): Promise<void>;
	writeBinary(path: string, content: ArrayBuffer): Promise<void>;
	delete(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export type ConflictResolution = 'keep-local' | 'keep-remote';

export interface ConflictResolver {
	resolve(conflicts: ConflictItem[]): Promise<Map<string, ConflictResolution> | 'cancel'>;
}

export interface FirstSyncResolver {
	resolve(summary: FirstSyncSummary): Promise<Map<string, ConflictResolution> | 'cancel'>;
}

export class SyncNeedsUIError extends Error {
	constructor() {
		super('Conflict resolution requires a UI — open the settings and choose a conflict policy.');
		this.name = 'SyncNeedsUIError';
	}
}

export class PolicyBasedResolver implements ConflictResolver, FirstSyncResolver {
	constructor(private readonly policy: 'always-prefer-local' | 'always-prefer-remote' | 'always-ask') {}

	resolve(
		conflicts: ConflictItem[] | FirstSyncSummary
	): Promise<Map<string, ConflictResolution> | 'cancel'> {
		if (this.policy === 'always-ask') {
			throw new SyncNeedsUIError();
		}

		const items: ConflictItem[] = Array.isArray(conflicts)
			? conflicts
			: (conflicts as FirstSyncSummary).conflicts;

		const resolution: ConflictResolution =
			this.policy === 'always-prefer-local' ? 'keep-local' : 'keep-remote';

		const result = new Map<string, ConflictResolution>();
		for (const item of items) {
			result.set(item.path, resolution);
		}
		return Promise.resolve(result);
	}
}

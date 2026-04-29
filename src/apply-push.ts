import type { ClassifiedPath, LocalChange } from './sync-engine-types';
import type { SyncState } from './state-store';
import type { Settings } from './settings';
import type { GitHubClient, TreeEntry } from './github-client';

export interface PushLogger {
	debug(event: string, data?: Record<string, unknown>): Promise<void>;
}

const MAX_FILE_LIST = 50;

export function formatCommitMessage(
	deviceName: string,
	changes: { added: string[]; modified: string[]; deleted: string[] },
): string {
	const timestamp = new Date().toISOString();
	const allLines = [
		...changes.added.map((p) => `+ ${p}`),
		...changes.modified.map((p) => `~ ${p}`),
		...changes.deleted.map((p) => `- ${p}`),
	];
	const total = allLines.length;

	let fileLines: string[];
	if (total > MAX_FILE_LIST) {
		fileLines = [...allLines.slice(0, MAX_FILE_LIST), `... and ${total - MAX_FILE_LIST} more`];
	} else {
		fileLines = allLines;
	}

	const lines = [
		`Obsidian sync from ${deviceName} at ${timestamp}`,
		'',
		`${total} file(s) changed:`,
		...fileLines,
	];
	return lines.join('\n');
}

export async function applyPush(
	paths: ClassifiedPath[],
	local: Map<string, LocalChange>,
	state: SyncState,
	client: GitHubClient,
	settings: Settings,
	remoteHeadSha: string,
	remoteTreeSha: string,
	logger: PushLogger,
): Promise<{ newCommitSha: string; updatedState: SyncState }> {
	if (paths.length === 0) {
		return { newCommitSha: remoteHeadSha, updatedState: state };
	}

	const { owner, repo, branch } = settings;

	const added: string[] = [];
	const modified: string[] = [];
	const deleted: string[] = [];

	for (const classified of paths) {
		if (classified.local === 'added') added.push(classified.path);
		else if (classified.local === 'modified') modified.push(classified.path);
		else if (classified.local === 'deleted') deleted.push(classified.path);
	}

	// Create blobs serially to avoid secondary rate limit hits
	const blobMap = new Map<string, string>();
	for (const path of [...added, ...modified]) {
		const change = local.get(path)!;
		if (!change.bytes) throw new Error(`Missing bytes for '${path}': added/modified LocalChange must include bytes`);
		const { sha } = await client.createBlob(owner, repo, change.bytes, change.isBinary);
		blobMap.set(path, sha);
		await logger.debug('sync.push.file', { path });
	}

	const entries: TreeEntry[] = [
		...[...added, ...modified].map((path) => ({
			path,
			mode: '100644' as const,
			type: 'blob' as const,
			sha: blobMap.get(path)!,
		})),
		...deleted.map((path) => ({
			path,
			mode: '100644' as const,
			type: 'blob' as const,
			sha: null,
		})),
	];

	const { sha: newTreeSha } = await client.createTree(owner, repo, remoteTreeSha, entries);

	const message = formatCommitMessage(settings.deviceName || 'Obsidian', { added, modified, deleted });

	const { sha: newCommitSha } = await client.createCommit(owner, repo, message, newTreeSha, remoteHeadSha);

	// GHFastForwardError bubbles to the orchestrator for retry
	await client.updateRef(owner, repo, branch, newCommitSha);

	state.lastSyncCommitSha = newCommitSha;
	state.lastSyncAt = new Date().toISOString();

	for (const path of [...added, ...modified]) {
		const change = local.get(path)!;
		state.files[path] = {
			path,
			blobSha: blobMap.get(path)!,
			contentHash: change.contentHash,
			size: change.size,
			isBinary: change.isBinary,
		};
	}
	for (const path of deleted) {
		delete state.files[path];
	}

	return { newCommitSha, updatedState: state };
}

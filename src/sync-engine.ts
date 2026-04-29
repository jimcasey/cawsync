import { buildLocalChangeSet } from './local-change-set';
import { buildRemoteChangeSet } from './remote-change-set';
import { classify } from './classifier';
import { applyPull } from './apply-pull';
import { applyPush } from './apply-push';
import { buildLocalInventory, buildFirstSyncSummary } from './first-sync';
import { GHFastForwardError } from './github-client';
import type { GitHubClient } from './github-client';
import type { StateStore, SyncState } from './state-store';
import type { Settings } from './settings';
import type {
	VaultAdapter,
	ConflictResolver,
	FirstSyncResolver,
	SyncResult,
	SyncReport,
	ClassifiedPath,
	ConflictItem,
	ConflictResolution,
} from './sync-engine-types';
import { PolicyBasedResolver } from './sync-engine-types';

const MAX_FF_RETRIES = 2;

export interface SyncLogger {
	debug(event: string, data?: Record<string, unknown>): Promise<void>;
	info(event: string, data?: Record<string, unknown>): Promise<void>;
	warn(event: string, data?: Record<string, unknown>): Promise<void>;
	error(event: string, data?: Record<string, unknown>): Promise<void>;
}

export class SyncEngine {
	private isSyncing = false;

	constructor(
		private readonly vault: VaultAdapter,
		private readonly client: GitHubClient,
		private readonly stateStore: StateStore,
		private readonly logger: SyncLogger,
		private readonly getSettings: () => Settings,
		private readonly conflicts: ConflictResolver,
		private readonly firstSync: FirstSyncResolver,
	) {}

	async sync(): Promise<SyncResult> {
		const settings = this.getSettings();

		// Pre-flight: validate settings
		if (!settings.pat || !settings.owner || !settings.repo || !settings.branch) {
			return {
				status: 'error',
				error: new Error('Sync settings incomplete: pat, owner, repo, and branch are required.'),
			};
		}

		// Acquire sync lock
		if (this.isSyncing) {
			return { status: 'cancelled' };
		}
		this.isSyncing = true;

		const startTime = Date.now();

		try {
			await this.logger.info('sync.start');

			const loadedState = await this.stateStore.load();

			if (loadedState === null) {
				return await this.runFirstSync(settings, startTime);
			}

			return await this.runNormalSync(settings, loadedState, startTime);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			await this.logger.error('sync.error', { error: error.message });
			return { status: 'error', error };
		} finally {
			this.isSyncing = false;
		}
	}

	private async runNormalSync(
		settings: Settings,
		syncState: SyncState,
		startTime: number,
	): Promise<SyncResult> {
		const { owner, repo, branch } = settings;
		let fastForwardRetries = 0;
		const policyResolver = new PolicyBasedResolver(settings.conflictPolicy);

		const report: SyncReport = {
			filesAdded: 0,
			filesModified: 0,
			filesDeleted: 0,
			conflictsResolved: 0,
			skippedOversized: [],
			commitSha: null,
			durationMs: 0,
		};

		while (true) {
			// Fetch remote head
			const { commitSha: remoteHeadSha, treeSha: remoteTreeSha } =
				await this.client.getBranch(owner, repo, branch);
			await this.logger.debug('sync.fetch.head', { commitSha: remoteHeadSha });

			// Build change sets
			const local = await buildLocalChangeSet(this.vault, syncState, settings);
			const remote = await buildRemoteChangeSet(this.client, owner, repo, remoteTreeSha, syncState);

			await this.logger.debug('sync.scan.local', { count: local.size });
			await this.logger.debug('sync.scan.remote', { count: remote.size });

			// Classify
			const classifierLogger = {
				warn: (event: string, data?: Record<string, unknown>) => {
					void this.logger.warn(event, data);
				},
			};
			const classified = classify(local, remote, syncState, classifierLogger);

			// Detect and resolve conflicts
			const conflictItems = classified.filter((c): c is ConflictItem => c.action === 'conflict');
			await this.logger.debug('sync.conflicts', {
				count: conflictItems.length,
				paths: conflictItems.map((c) => c.path),
			});

			let conflictResolutions = new Map<string, ConflictResolution>();

			if (conflictItems.length > 0) {
				if (settings.conflictPolicy !== 'always-ask') {
					conflictResolutions = (await policyResolver.resolve(conflictItems)) as Map<string, ConflictResolution>;
				} else {
					const result = await this.conflicts.resolve(conflictItems);
					if (result === 'cancel') {
						return { status: 'cancelled' };
					}
					conflictResolutions = result;
				}
				report.conflictsResolved = conflictResolutions.size;
			}

			// Partition into pull and push lists
			const pullPaths: ClassifiedPath[] = [];
			const pushPaths: ClassifiedPath[] = [];

			for (const item of classified) {
				if (item.action === 'pull') {
					pullPaths.push(item);
				} else if (item.action === 'push') {
					pushPaths.push(item);
				} else if (item.action === 'conflict') {
					const resolution = conflictResolutions.get(item.path);
					if (resolution === 'keep-remote') {
						pullPaths.push(item);
					} else if (resolution === 'keep-local') {
						pushPaths.push(item);
					}
				}
			}

			// Apply pull
			if (pullPaths.length > 0) {
				const { updatedState, skipped } = await applyPull(
					pullPaths, remote, this.client, this.vault, syncState, settings, this.logger,
				);
				syncState = updatedState;

				const skippedSet = new Set(skipped);
				for (const item of pullPaths) {
					if (skippedSet.has(item.path)) continue;
					const remoteChange = remote.get(item.path);
					if (!remoteChange || remoteChange.type === 'unchanged') continue;
					if (remoteChange.type === 'added') report.filesAdded++;
					else if (remoteChange.type === 'modified') report.filesModified++;
					else if (remoteChange.type === 'deleted') report.filesDeleted++;
				}

				report.skippedOversized.push(...skipped);
				await this.stateStore.save(syncState);
			}

			// Apply push (or skip if nothing to push)
			if (pushPaths.length === 0) {
				syncState.lastSyncCommitSha = remoteHeadSha;
				syncState.lastSyncAt = new Date().toISOString();
				await this.stateStore.save(syncState);
				break;
			}

			try {
				const { newCommitSha, updatedState } = await applyPush(
					pushPaths, local, syncState, this.client, settings, remoteHeadSha, remoteTreeSha, this.logger,
				);
				syncState = updatedState;
				report.commitSha = newCommitSha;

				for (const item of pushPaths) {
					const localChange = local.get(item.path);
					if (!localChange) continue;
					if (localChange.type === 'added') report.filesAdded++;
					else if (localChange.type === 'modified') report.filesModified++;
					else if (localChange.type === 'deleted') report.filesDeleted++;
				}

				await this.logger.info('sync.commit', { commitSha: newCommitSha });
				await this.stateStore.save(syncState);
				break;
			} catch (err) {
				if (err instanceof GHFastForwardError) {
					if (fastForwardRetries >= MAX_FF_RETRIES) {
						throw err;
					}
					fastForwardRetries++;
					continue;
				}
				throw err;
			}
		}

		report.durationMs = Date.now() - startTime;
		const anyChanges =
			report.filesAdded > 0 ||
			report.filesModified > 0 ||
			report.filesDeleted > 0 ||
			report.commitSha !== null;
		const status = anyChanges ? 'success' : 'up-to-date';

		await this.logger.info('sync.complete', {
			status,
			filesAdded: report.filesAdded,
			filesModified: report.filesModified,
			filesDeleted: report.filesDeleted,
			conflictsResolved: report.conflictsResolved,
			durationMs: report.durationMs,
		});

		return { status, report };
	}

	private async runFirstSync(settings: Settings, startTime: number): Promise<SyncResult> {
		const { owner, repo, branch } = settings;

		const { commitSha: remoteHeadSha, treeSha: remoteTreeSha } =
			await this.client.getBranch(owner, repo, branch);
		await this.logger.debug('sync.fetch.head', { commitSha: remoteHeadSha });

		let syncState: SyncState = {
			schemaVersion: 1,
			lastSyncCommitSha: null,
			lastSyncAt: new Date().toISOString(),
			files: {},
		};

		const localInventory = await buildLocalInventory(this.vault, settings);
		const remoteTree = await buildRemoteChangeSet(this.client, owner, repo, remoteTreeSha, syncState);
		const summary = await buildFirstSyncSummary(localInventory, remoteTree);

		const resolveResult = await this.firstSync.resolve(summary);
		if (resolveResult === 'cancel') {
			return { status: 'cancelled' };
		}
		const conflictResolutions = resolveResult;

		const report: SyncReport = {
			filesAdded: 0,
			filesModified: 0,
			filesDeleted: 0,
			conflictsResolved: conflictResolutions.size,
			skippedOversized: [],
			commitSha: null,
			durationMs: 0,
		};

		const pullPaths: ClassifiedPath[] = [];
		const pushPaths: ClassifiedPath[] = [];

		for (const path of summary.remoteOnly) {
			pullPaths.push({ path, action: 'pull', local: 'unchanged', remote: 'added' });
		}

		for (const path of summary.localOnly) {
			pushPaths.push({ path, action: 'push', local: 'added', remote: 'unchanged' });
		}

		for (const conflict of summary.conflicts) {
			const resolution = conflictResolutions.get(conflict.path);
			if (resolution === 'keep-remote') {
				pullPaths.push(conflict);
			} else if (resolution === 'keep-local') {
				pushPaths.push(conflict);
			}
		}

		// Identical files: record in state directly without network I/O
		for (const path of summary.identical) {
			const local = localInventory.get(path)!;
			const remote = remoteTree.get(path)!;
			syncState.files[path] = {
				path,
				blobSha: remote.blobSha!,
				contentHash: local.contentHash,
				size: local.size,
				isBinary: local.isBinary,
			};
		}

		// Apply pull
		if (pullPaths.length > 0) {
			const { updatedState, skipped } = await applyPull(
				pullPaths, remoteTree, this.client, this.vault, syncState, settings, this.logger,
			);
			syncState = updatedState;

			for (const item of pullPaths) {
				if (!skipped.includes(item.path)) report.filesAdded++;
			}
			report.skippedOversized.push(...skipped);
		}

		// Apply push
		if (pushPaths.length > 0) {
			const { newCommitSha, updatedState } = await applyPush(
				pushPaths, localInventory, syncState, this.client, settings, remoteHeadSha, remoteTreeSha, this.logger,
			);
			syncState = updatedState;
			report.commitSha = newCommitSha;
			// All first-sync push paths are 'added' (localOnly + keep-local conflicts)
			report.filesAdded += pushPaths.length;

			await this.logger.info('sync.commit', { commitSha: newCommitSha });
		} else {
			syncState.lastSyncCommitSha = remoteHeadSha;
			syncState.lastSyncAt = new Date().toISOString();
		}

		// Write state for the first time
		await this.stateStore.save(syncState);

		report.durationMs = Date.now() - startTime;
		const anyChanges =
			report.filesAdded > 0 ||
			report.filesModified > 0 ||
			report.filesDeleted > 0 ||
			report.commitSha !== null;
		const status = anyChanges ? 'success' : 'up-to-date';

		await this.logger.info('sync.complete', {
			status,
			filesAdded: report.filesAdded,
			filesModified: report.filesModified,
			filesDeleted: report.filesDeleted,
			conflictsResolved: report.conflictsResolved,
			durationMs: report.durationMs,
		});

		return { status, report };
	}
}

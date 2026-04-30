import type { SyncResult } from './sync-engine-types';

export type StatusBarUpdate =
	| { kind: 'idle'; lastSyncAt: string | null }
	| { kind: 'error'; message: string };

export interface SyncNoticeOutcome {
	toasts: string[];
	statusBar: StatusBarUpdate;
}

const SYNC_NEEDS_UI_MESSAGE =
	"Conflict resolution UI is not yet available. Choose 'Prefer local' or 'Prefer remote' in settings, or wait for the next release.";
const SYNC_NEEDS_UI_STATUS = 'Conflict — set conflict policy';

export function formatSyncOutcome(
	result: SyncResult,
	now: () => string,
	lastKnownSyncAt: string | null,
): SyncNoticeOutcome {
	switch (result.status) {
		case 'up-to-date':
			return {
				toasts: ['Already up to date.'],
				statusBar: { kind: 'idle', lastSyncAt: now() },
			};
		case 'success': {
			const { filesAdded, filesModified, filesDeleted, skippedOversized } = result.report;
			const total = filesAdded + filesModified + filesDeleted;
			const toasts = [`Synced ${total} change${total === 1 ? '' : 's'}.`];
			if (skippedOversized.length > 0) {
				const first3 = skippedOversized.slice(0, 3).join(', ');
				const rest = skippedOversized.length - 3;
				const suffix = rest > 0 ? ` and ${rest} more` : '';
				toasts.push(`Skipped: ${first3}${suffix}`);
			}
			return {
				toasts,
				statusBar: { kind: 'idle', lastSyncAt: now() },
			};
		}
		case 'cancelled':
			return {
				toasts: [],
				statusBar: { kind: 'idle', lastSyncAt: lastKnownSyncAt },
			};
		case 'error':
			if (result.error.name === 'SyncNeedsUIError') {
				return {
					toasts: [SYNC_NEEDS_UI_MESSAGE],
					statusBar: { kind: 'error', message: SYNC_NEEDS_UI_STATUS },
				};
			}
			if (result.error.name === 'GHEmptyRepoError') {
				return {
					toasts: [result.error.message],
					statusBar: { kind: 'error', message: 'Repo has no commits yet' },
				};
			}
			return {
				toasts: [`Sync failed: ${result.error.message}. See log for details.`],
				statusBar: { kind: 'error', message: result.error.message },
			};
	}
}

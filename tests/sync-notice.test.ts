import { describe, expect, test } from 'vitest';
import { formatSyncOutcome } from '../src/sync-notice';
import { SyncNeedsUIError } from '../src/sync-engine-types';
import type { SyncReport, SyncResult } from '../src/sync-engine-types';

const NOW = '2026-04-30T12:00:00.000Z';
const now = (): string => NOW;

function emptyReport(overrides: Partial<SyncReport> = {}): SyncReport {
	return {
		filesAdded: 0,
		filesModified: 0,
		filesDeleted: 0,
		conflictsResolved: 0,
		skippedOversized: [],
		commitSha: null,
		durationMs: 0,
		...overrides,
	};
}

describe('formatSyncOutcome', () => {
	test('up-to-date emits the up-to-date toast and idle status with current time', () => {
		const result: SyncResult = { status: 'up-to-date', report: emptyReport() };
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual(['Already up to date.']);
		expect(outcome.statusBar).toEqual({ kind: 'idle', lastSyncAt: NOW });
	});

	test('success summarizes total changes', () => {
		const result: SyncResult = {
			status: 'success',
			report: emptyReport({ filesAdded: 2, filesModified: 1, filesDeleted: 1, commitSha: 'abc' }),
		};
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual(['Synced 4 changes.']);
		expect(outcome.statusBar).toEqual({ kind: 'idle', lastSyncAt: NOW });
	});

	test('success with one change uses singular wording', () => {
		const result: SyncResult = {
			status: 'success',
			report: emptyReport({ filesAdded: 1, commitSha: 'abc' }),
		};
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual(['Synced 1 change.']);
	});

	test('success with skipped-oversized lists first 3 with "and N more" suffix', () => {
		const result: SyncResult = {
			status: 'success',
			report: emptyReport({
				filesAdded: 1,
				skippedOversized: ['big1.bin', 'big2.bin', 'big3.bin', 'big4.bin', 'big5.bin'],
			}),
		};
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual([
			'Synced 1 change.',
			'Skipped: big1.bin, big2.bin, big3.bin and 2 more',
		]);
	});

	test('success with skipped-oversized of length 3 omits the "and N more" suffix', () => {
		const result: SyncResult = {
			status: 'success',
			report: emptyReport({ filesAdded: 0, skippedOversized: ['a', 'b', 'c'] }),
		};
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual([
			'Synced 0 changes.',
			'Skipped: a, b, c',
		]);
	});

	test('cancelled emits no toast and reverts status bar to last known sync time', () => {
		const lastKnown = '2026-04-30T11:00:00.000Z';
		const result: SyncResult = { status: 'cancelled' };
		const outcome = formatSyncOutcome(result, now, lastKnown);

		expect(outcome.toasts).toEqual([]);
		expect(outcome.statusBar).toEqual({ kind: 'idle', lastSyncAt: lastKnown });
	});

	test('cancelled with no last known sync time leaves status bar in never-synced state', () => {
		const outcome = formatSyncOutcome({ status: 'cancelled' }, now, null);
		expect(outcome.statusBar).toEqual({ kind: 'idle', lastSyncAt: null });
	});

	test('SyncNeedsUIError produces dedicated message and dedicated status bar text', () => {
		const result: SyncResult = { status: 'error', error: new SyncNeedsUIError() };
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual([
			"Conflict resolution UI is not yet available. Choose 'Prefer local' or 'Prefer remote' in settings, or wait for the next release.",
		]);
		expect(outcome.statusBar).toEqual({
			kind: 'error',
			message: 'Conflict — set conflict policy',
		});
	});

	test('GHEmptyRepoError produces actionable message and short status bar text', () => {
		const err = Object.assign(
			new Error('The repository exists but has no commits yet. Push an initial commit (e.g. a README) and try again.'),
			{ name: 'GHEmptyRepoError' },
		);
		const result: SyncResult = { status: 'error', error: err };
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual([
			'The repository exists but has no commits yet. Push an initial commit (e.g. a README) and try again.',
		]);
		expect(outcome.statusBar).toEqual({
			kind: 'error',
			message: 'Repo has no commits yet',
		});
	});

	test('generic error includes the error message and points to the log', () => {
		const result: SyncResult = {
			status: 'error',
			error: new Error('Network unreachable'),
		};
		const outcome = formatSyncOutcome(result, now, null);

		expect(outcome.toasts).toEqual([
			'Sync failed: Network unreachable. See log for details.',
		]);
		expect(outcome.statusBar).toEqual({
			kind: 'error',
			message: 'Network unreachable',
		});
	});
});

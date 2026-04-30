import { describe, test, expect } from 'vitest';
import { computeLineDiff } from '../src/ui/diff';

describe('computeLineDiff', () => {
	test('both empty inputs return []', () => {
		expect(computeLineDiff('', '')).toEqual([]);
	});

	test('identical inputs are all context', () => {
		const local = 'alpha\nbeta\ngamma\n';
		const result = computeLineDiff(local, local);
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'context', text: 'beta', localLineNumber: 2, remoteLineNumber: 2 },
			{ kind: 'context', text: 'gamma', localLineNumber: 3, remoteLineNumber: 3 },
		]);
	});

	test('pure addition: one extra line at end', () => {
		const local = 'alpha\nbeta\n';
		const remote = 'alpha\nbeta\ngamma\n';
		const result = computeLineDiff(local, remote);
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'context', text: 'beta', localLineNumber: 2, remoteLineNumber: 2 },
			{ kind: 'add', text: 'gamma', remoteLineNumber: 3 },
		]);
	});

	test('pure deletion: one line removed from middle', () => {
		const local = 'alpha\nbeta\ngamma\n';
		const remote = 'alpha\ngamma\n';
		const result = computeLineDiff(local, remote);
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'remove', text: 'beta', localLineNumber: 2 },
			{ kind: 'context', text: 'gamma', localLineNumber: 3, remoteLineNumber: 2 },
		]);
	});

	test('replacement: one line removed and one added at same position', () => {
		const local = 'alpha\nbeta\ngamma\n';
		const remote = 'alpha\nBETA\ngamma\n';
		const result = computeLineDiff(local, remote);
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'remove', text: 'beta', localLineNumber: 2 },
			{ kind: 'add', text: 'BETA', remoteLineNumber: 2 },
			{ kind: 'context', text: 'gamma', localLineNumber: 3, remoteLineNumber: 3 },
		]);
	});

	test('empty local, non-empty remote: all add', () => {
		const result = computeLineDiff('', 'one\ntwo\nthree\n');
		expect(result).toEqual([
			{ kind: 'add', text: 'one', remoteLineNumber: 1 },
			{ kind: 'add', text: 'two', remoteLineNumber: 2 },
			{ kind: 'add', text: 'three', remoteLineNumber: 3 },
		]);
	});

	test('empty remote, non-empty local: all remove', () => {
		const result = computeLineDiff('one\ntwo\nthree\n', '');
		expect(result).toEqual([
			{ kind: 'remove', text: 'one', localLineNumber: 1 },
			{ kind: 'remove', text: 'two', localLineNumber: 2 },
			{ kind: 'remove', text: 'three', localLineNumber: 3 },
		]);
	});

	test('line numbering is correct across a multi-hunk diff', () => {
		const local = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n';
		const remote = ['a', 'B', 'c', 'd', 'E', 'F', 'g'].join('\n') + '\n';
		const result = computeLineDiff(local, remote);

		// Walk result and verify cursors stay in sync
		let nextLocal = 1;
		let nextRemote = 1;
		for (const line of result) {
			if (line.kind === 'context') {
				expect(line.localLineNumber).toBe(nextLocal++);
				expect(line.remoteLineNumber).toBe(nextRemote++);
			} else if (line.kind === 'add') {
				expect(line.localLineNumber).toBeUndefined();
				expect(line.remoteLineNumber).toBe(nextRemote++);
			} else {
				expect(line.remoteLineNumber).toBeUndefined();
				expect(line.localLineNumber).toBe(nextLocal++);
			}
		}
		// Total local lines consumed = 7, total remote lines consumed = 7
		expect(nextLocal).toBe(8);
		expect(nextRemote).toBe(8);

		// Check the lines that should be removed/added
		const removed = result.filter(l => l.kind === 'remove').map(l => l.text);
		const added = result.filter(l => l.kind === 'add').map(l => l.text);
		expect(removed).toEqual(['b', 'e', 'f']);
		expect(added).toEqual(['B', 'E', 'F']);
	});

	test('handles input without trailing newline', () => {
		const local = 'alpha\nbeta';
		const remote = 'alpha\nbeta\ngamma';
		const result = computeLineDiff(local, remote);
		// diffLines treats 'beta' and 'beta\n' as distinct tokens, so the
		// no-trailing-newline 'beta' is removed and the trailing-newline
		// 'beta' is re-added. This is an acceptable line-diff limitation.
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'remove', text: 'beta', localLineNumber: 2 },
			{ kind: 'add', text: 'beta', remoteLineNumber: 2 },
			{ kind: 'add', text: 'gamma', remoteLineNumber: 3 },
		]);
	});

	test('replacement of single-line content without newlines', () => {
		const result = computeLineDiff('one', 'two');
		expect(result).toEqual([
			{ kind: 'remove', text: 'one', localLineNumber: 1 },
			{ kind: 'add', text: 'two', remoteLineNumber: 1 },
		]);
	});

	test('preserves blank lines as empty-text entries', () => {
		const local = 'alpha\n\nbeta\n';
		const remote = 'alpha\n\nbeta\n';
		const result = computeLineDiff(local, remote);
		expect(result).toEqual([
			{ kind: 'context', text: 'alpha', localLineNumber: 1, remoteLineNumber: 1 },
			{ kind: 'context', text: '', localLineNumber: 2, remoteLineNumber: 2 },
			{ kind: 'context', text: 'beta', localLineNumber: 3, remoteLineNumber: 3 },
		]);
	});
});

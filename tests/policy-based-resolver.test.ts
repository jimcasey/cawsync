import { expect, test } from 'vitest';
import { PolicyBasedResolver, SyncNeedsUIError } from '../src/sync-engine-types';
import type { ConflictItem } from '../src/sync-engine-types';
import type { ConflictPolicy } from '../src/settings';

function makeConflicts(): ConflictItem[] {
	return [
		{
			path: 'a.md',
			action: 'conflict',
			local: 'modified',
			remote: 'modified',
			isBinary: false,
			localSize: 0,
			remoteSize: 0,
		},
	];
}

test('reads policy fresh on each resolve — value change after construction takes effect', async () => {
	let policy: ConflictPolicy = 'always-prefer-local';
	const resolver = new PolicyBasedResolver(() => policy);

	const first = (await resolver.resolve(makeConflicts())) as Map<string, 'keep-local' | 'keep-remote'>;
	expect(first.get('a.md')).toBe('keep-local');

	policy = 'always-prefer-remote';

	const second = (await resolver.resolve(makeConflicts())) as Map<string, 'keep-local' | 'keep-remote'>;
	expect(second.get('a.md')).toBe('keep-remote');
});

test('switching policy to always-ask after construction throws SyncNeedsUIError', async () => {
	let policy: ConflictPolicy = 'always-prefer-local';
	const resolver = new PolicyBasedResolver(() => policy);

	await expect(resolver.resolve(makeConflicts())).resolves.toBeDefined();

	policy = 'always-ask';

	expect(() => resolver.resolve(makeConflicts())).toThrow(SyncNeedsUIError);
});

test('always-ask at construction throws on resolve', () => {
	const resolver = new PolicyBasedResolver(() => 'always-ask');
	expect(() => resolver.resolve(makeConflicts())).toThrow(SyncNeedsUIError);
});

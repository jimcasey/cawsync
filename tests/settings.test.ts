import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { SELF_EXCLUDED_PATHS } from './constants';

test('DEFAULT_SETTINGS matches spec values', () => {
	expect(DEFAULT_SETTINGS.conflictPolicy).toBe('always-ask');
	expect(DEFAULT_SETTINGS.perFileSizeLimitMb).toBe(25);
	expect(DEFAULT_SETTINGS.deviceName).toBe('');
	expect(DEFAULT_SETTINGS.includeObsidianConfig).toBe(false);
	expect(DEFAULT_SETTINGS.excludePatterns).toEqual(['*.tmp', '*.swp', '.DS_Store', 'Thumbs.db', '.trash/**']);
	expect(DEFAULT_SETTINGS.verboseLogging).toBe(false);
});

test('SELF_EXCLUDED_PATHS contains all required plugin files', () => {
	const paths = SELF_EXCLUDED_PATHS;
	expect(paths.some(p => p.endsWith('data.json'))).toBe(true);
	expect(paths.some(p => p.endsWith('sync-state.json') && !p.endsWith('.tmp'))).toBe(true);
	expect(paths.some(p => p.endsWith('sync-state.json.tmp'))).toBe(true);
	expect(paths.some(p => p.endsWith('sync.log') && !p.endsWith('.1'))).toBe(true);
	expect(paths.some(p => p.endsWith('sync.log.1'))).toBe(true);
});

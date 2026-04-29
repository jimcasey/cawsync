import { describe, test, expect } from 'vitest';
import { parseGitignorePatterns, matchesGlob, isExcluded, FileScanner } from '../src/file-scanner';
import type { VaultAdapter } from '../src/sync-engine-types';

interface AdapterSpec {
	exists?: Record<string, boolean>;
	listFiles?: string[];
	listDirectory?: Record<string, { files: string[]; dirs: string[] }>;
	readText?: Record<string, string>;
}

function makeAdapter(spec: AdapterSpec = {}): VaultAdapter {
	return {
		exists: (path: string) => Promise.resolve(spec.exists?.[path] ?? false),
		listFiles: () => Promise.resolve(spec.listFiles ?? []),
		listDirectory: (path: string) =>
			Promise.resolve(spec.listDirectory?.[path] ?? { files: [], dirs: [] }),
		readText: (path: string) => Promise.resolve(spec.readText?.[path] ?? ''),
		readBinary: () => Promise.resolve(new ArrayBuffer(0)),
		writeText: () => Promise.resolve(),
		writeBinary: () => Promise.resolve(),
		delete: () => Promise.resolve(),
	};
}

describe('parseGitignorePatterns', () => {
	test('returns non-blank, non-comment, non-negation lines', () => {
		const content = ['*.log', 'node_modules/', '.DS_Store'].join('\n');
		expect(parseGitignorePatterns(content)).toEqual(['*.log', 'node_modules/', '.DS_Store']);
	});

	test('skips blank lines', () => {
		expect(parseGitignorePatterns('\n\n*.log\n\n')).toEqual(['*.log']);
	});

	test('skips comment lines', () => {
		expect(parseGitignorePatterns('# comment\n*.log\n# another')).toEqual(['*.log']);
	});

	test('skips negation lines without error', () => {
		expect(parseGitignorePatterns('*.log\n!important.log\n*.tmp')).toEqual(['*.log', '*.tmp']);
	});

	test('trims whitespace from lines', () => {
		expect(parseGitignorePatterns('  *.log  ')).toEqual(['*.log']);
	});

	test('empty content returns empty array', () => {
		expect(parseGitignorePatterns('')).toEqual([]);
	});
});

describe('matchesGlob', () => {
	test('* matches within a single path segment', () => {
		expect(matchesGlob('*.tmp', 'file.tmp')).toBe(true);
		expect(matchesGlob('*.tmp', 'file.txt')).toBe(false);
	});

	test('pattern without slash matches against basename at any depth', () => {
		expect(matchesGlob('.DS_Store', '.DS_Store')).toBe(true);
		expect(matchesGlob('.DS_Store', 'notes/.DS_Store')).toBe(true);
		expect(matchesGlob('.DS_Store', 'notes/file.md')).toBe(false);
		expect(matchesGlob('*.tmp', 'deep/nested/file.tmp')).toBe(true);
	});

	test('** matches across path segments', () => {
		expect(matchesGlob('.trash/**', '.trash/file.md')).toBe(true);
		expect(matchesGlob('.trash/**', '.trash/subdir/file.md')).toBe(true);
		expect(matchesGlob('.trash/**', 'other/file.md')).toBe(false);
	});

	test('trailing slash is treated as directory prefix match', () => {
		expect(matchesGlob('node_modules/', 'node_modules/lodash/index.js')).toBe(true);
		expect(matchesGlob('node_modules/', 'other/index.js')).toBe(false);
	});

	test('* does not match partial names (guards against missing escape)', () => {
		expect(matchesGlob('*.tmp', 'tmpfile')).toBe(false);
		expect(matchesGlob('*.tmp', 'notes/tmpfile')).toBe(false);
	});

	test('pattern with slash matches full vault-relative path', () => {
		expect(
			matchesGlob(
				'.obsidian/plugins/jackdaw/data.json',
				'.obsidian/plugins/jackdaw/data.json',
			),
		).toBe(true);
		expect(matchesGlob('.obsidian/plugins/jackdaw/data.json', 'other/data.json')).toBe(false);
	});
});

describe('isExcluded', () => {
	test('returns true when any pattern matches', () => {
		expect(isExcluded('file.tmp', ['*.tmp', '*.swp'])).toBe(true);
		expect(isExcluded('file.swp', ['*.tmp', '*.swp'])).toBe(true);
	});

	test('returns false when no pattern matches', () => {
		expect(isExcluded('notes.md', ['*.tmp', '*.swp'])).toBe(false);
	});

	test('returns false for empty pattern list', () => {
		expect(isExcluded('file.tmp', [])).toBe(false);
	});
});

describe('FileScanner', () => {
	test('no .gitignore: returns all vault files not excluded by self or user patterns', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: ['notes/hello.md', 'notes/world.md', 'image.png'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		expect(await scanner.scan()).toEqual(['notes/hello.md', 'notes/world.md', 'image.png']);
	});

	test('.gitignore patterns exclude matching files', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': true },
			readText: { '.gitignore': '*.log\nbuild/' },
			listFiles: ['notes/hello.md', 'error.log', 'build/output.js'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).toContain('notes/hello.md');
		expect(results).not.toContain('error.log');
		expect(results).not.toContain('build/output.js');
	});

	test('.gitignore comment lines, blank lines, and negation lines are safely ignored', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': true },
			readText: {
				'.gitignore': [
					'# Build output',
					'',
					'*.log',
					'!important.log',
					'',
					'*.tmp',
				].join('\n'),
			},
			listFiles: ['build.log', 'important.log', 'temp.tmp', 'notes.md'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		// *.log pattern applies; negation line is ignored for v1
		expect(results).not.toContain('build.log');
		expect(results).not.toContain('important.log');
		expect(results).not.toContain('temp.tmp');
		expect(results).toContain('notes.md');
	});

	test('.gitignore and .gitattributes are not excluded', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': true },
			readText: { '.gitignore': '*.log' },
			listFiles: ['.gitignore', '.gitattributes', 'notes.md', 'debug.log'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).toContain('.gitignore');
		expect(results).toContain('.gitattributes');
		expect(results).not.toContain('debug.log');
	});

	test('user exclude patterns are applied', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: ['notes.md', 'temp.swp', '.DS_Store', 'data.tmp'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: ['*.swp', '.DS_Store', '*.tmp'],
		});
		const results = await scanner.scan();
		expect(results).toContain('notes.md');
		expect(results).not.toContain('temp.swp');
		expect(results).not.toContain('.DS_Store');
		expect(results).not.toContain('data.tmp');
	});

	test('self-excluded plugin paths are never included', async () => {
		const pluginFiles = [
			'.obsidian/plugins/jackdaw/data.json',
			'.obsidian/plugins/jackdaw/sync-state.json',
			'.obsidian/plugins/jackdaw/sync-state.json.tmp',
			'.obsidian/plugins/jackdaw/sync.log',
			'.obsidian/plugins/jackdaw/sync.log.1',
		];
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: [...pluginFiles, 'notes.md'],
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		for (const p of pluginFiles) {
			expect(results).not.toContain(p);
		}
		expect(results).toContain('notes.md');
	});

	test('.git directory is never descended into during adapter walk', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: [],
			listDirectory: {
				'.obsidian': { files: ['app.json'], dirs: ['.git', 'plugins'] },
				// If .git were descended into, COMMIT_EDITMSG would be found
				'.obsidian/.git': { files: ['COMMIT_EDITMSG'], dirs: [] },
				'.obsidian/plugins': { files: ['my-plugin.js'], dirs: [] },
			},
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: true,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).not.toContain('.obsidian/.git/COMMIT_EDITMSG');
		expect(results).toContain('.obsidian/app.json');
		expect(results).toContain('.obsidian/plugins/my-plugin.js');
	});

	test('obsidian config walk is skipped when includeObsidianConfig is false', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: ['notes.md'],
			listDirectory: {
				'.obsidian': { files: ['app.json'], dirs: [] },
			},
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: false,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).toEqual(['notes.md']);
	});

	test('obsidian config walk includes files when includeObsidianConfig is true', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: ['notes.md'],
			listDirectory: {
				'.obsidian': { files: ['app.json'], dirs: ['snippets'] },
				'.obsidian/snippets': { files: ['custom.css'], dirs: [] },
			},
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: true,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).toContain('notes.md');
		expect(results).toContain('.obsidian/app.json');
		expect(results).toContain('.obsidian/snippets/custom.css');
	});

	test('self-excluded paths are filtered from obsidian walk too', async () => {
		const adapter = makeAdapter({
			exists: { '.gitignore': false },
			listFiles: [],
			listDirectory: {
				'.obsidian': { files: [], dirs: ['plugins'] },
				'.obsidian/plugins': { files: [], dirs: ['jackdaw'] },
				'.obsidian/plugins/jackdaw': {
					files: ['data.json', 'sync-state.json', 'main.js'],
					dirs: [],
				},
			},
		});
		const scanner = new FileScanner(adapter, {
			includeObsidianConfig: true,
			userExcludePatterns: [],
		});
		const results = await scanner.scan();
		expect(results).not.toContain('.obsidian/plugins/jackdaw/data.json');
		expect(results).not.toContain('.obsidian/plugins/jackdaw/sync-state.json');
		expect(results).toContain('.obsidian/plugins/jackdaw/main.js');
	});
});

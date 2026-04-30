import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Logger } from '../src/logger';

const PREFIX = '.obsidian/plugins/jackdaw';
const LOG_PATH = `${PREFIX}/sync.log`;
const BACKUP_PATH = `${PREFIX}/sync.log.1`;
const MAX_BYTES = 1024 * 1024;

function makeAdapter(files: Record<string, string> = {}) {
	const store: Record<string, string> = { ...files };
	return {
		store,
		exists: vi.fn(async (path: string) => path in store),
		stat: vi.fn(async (path: string) => {
			if (!(path in store)) return null;
			return { size: Buffer.byteLength(store[path], 'utf8'), ctime: 0, mtime: 0, type: 'file' as const };
		}),
		append: vi.fn(async (path: string, data: string) => {
			store[path] = (store[path] ?? '') + data;
		}),
		rename: vi.fn(async (from: string, to: string) => {
			store[to] = store[from];
			delete store[from];
		}),
		remove: vi.fn(async (path: string) => {
			delete store[path];
		}),
	};
}

describe('Logger', () => {
	let adapter: ReturnType<typeof makeAdapter>;

	beforeEach(() => {
		adapter = makeAdapter();
	});

	test('emits one JSON line per write in JSONL format', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.info('sync.start');
		await logger.info('sync.complete', { duration: 100 });

		const content = adapter.store[LOG_PATH];
		const lines = content.trimEnd().split('\n');
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0]);
		expect(first.level).toBe('info');
		expect(first.event).toBe('sync.start');
		expect(typeof first.ts).toBe('string');
		expect(first.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const second = JSON.parse(lines[1]);
		expect(second.event).toBe('sync.complete');
		expect(second.duration).toBe(100);
	});

	test('spreads fields into the top-level JSON object', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.warn('sync.conflicts', { count: 3, paths: ['a.md', 'b.md'] });

		const line = adapter.store[LOG_PATH].trim();
		const entry = JSON.parse(line);
		expect(entry.count).toBe(3);
		expect(entry.paths).toEqual(['a.md', 'b.md']);
	});

	test('rotates at the 1 MB boundary and sync.log.1 contains prior contents', async () => {
		const priorContent = 'x'.repeat(MAX_BYTES);
		adapter = makeAdapter({ [LOG_PATH]: priorContent });

		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.info('sync.start');

		expect(adapter.store[BACKUP_PATH]).toBe(priorContent);
		expect(adapter.store[LOG_PATH]).not.toBe(priorContent);

		const newLine = adapter.store[LOG_PATH].trim();
		const entry = JSON.parse(newLine);
		expect(entry.event).toBe('sync.start');
	});

	test('rotation overwrites an existing sync.log.1', async () => {
		const priorContent = 'x'.repeat(MAX_BYTES);
		const oldBackup = 'old backup content';
		adapter = makeAdapter({ [LOG_PATH]: priorContent, [BACKUP_PATH]: oldBackup });

		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.info('sync.start');

		expect(adapter.store[BACKUP_PATH]).toBe(priorContent);
		expect(adapter.remove).toHaveBeenCalledWith(BACKUP_PATH);
	});

	test('does not rotate when log is below 1 MB', async () => {
		const smallContent = '{"ts":"2026-01-01","level":"info","event":"sync.start"}\n';
		adapter = makeAdapter({ [LOG_PATH]: smallContent });

		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.info('sync.complete');

		expect(adapter.rename).not.toHaveBeenCalled();
		const lines = adapter.store[LOG_PATH].trimEnd().split('\n');
		expect(lines).toHaveLength(2);
	});

	test('scrubs PAT from field values', async () => {
		const pat = 'ghp_supersecrettoken';
		const logger = new Logger(adapter as never, PREFIX, () => true, () => pat);
		await logger.info('sync.error', { message: `failed with token ${pat}` });

		const line = adapter.store[LOG_PATH].trim();
		expect(line).not.toContain(pat);
		expect(line).toContain('***');
	});

	test('scrubs Authorization Bearer value', async () => {
		const pat = 'ghp_mytoken';
		const logger = new Logger(adapter as never, PREFIX, () => true, () => pat);
		await logger.info('api.call', { header: 'Authorization: Bearer ghp_mytoken' });

		const line = adapter.store[LOG_PATH].trim();
		expect(line).not.toContain('ghp_mytoken');
		expect(line).toContain('Authorization: Bearer ***');
	});

	test('scrubs Authorization header even when PAT is unknown', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.info('api.call', { header: 'Authorization: Bearer someOtherToken' });

		const line = adapter.store[LOG_PATH].trim();
		expect(line).not.toContain('someOtherToken');
		expect(line).toContain('Authorization: Bearer ***');
	});

	test('debug is silent when verbose logging is off', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => false, () => '');
		await logger.debug('sync.pull.file', { path: 'notes/a.md' });

		expect(adapter.append).not.toHaveBeenCalled();
		expect(LOG_PATH in adapter.store).toBe(false);
	});

	test('debug emits when verbose logging is on', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => true, () => '');
		await logger.debug('sync.pull.file', { path: 'notes/a.md' });

		const line = adapter.store[LOG_PATH].trim();
		const entry = JSON.parse(line);
		expect(entry.level).toBe('debug');
		expect(entry.event).toBe('sync.pull.file');
		expect(entry.path).toBe('notes/a.md');
	});

	test('warn and error always emit regardless of verbose flag', async () => {
		const logger = new Logger(adapter as never, PREFIX, () => false, () => '');
		await logger.warn('sync.conflicts', { count: 1 });
		await logger.error('sync.error', { message: 'boom' });

		const lines = adapter.store[LOG_PATH].trimEnd().split('\n');
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).level).toBe('warn');
		expect(JSON.parse(lines[1]).level).toBe('error');
	});
});

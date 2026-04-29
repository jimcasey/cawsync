import { describe, test, expect, vi, type Mock } from 'vitest';
import { StateStore, type SyncState, type Logger, type StateAdapter } from './state-store';

const PLUGIN_FOLDER = '.obsidian/plugins/jackdaw';
const CANONICAL = `${PLUGIN_FOLDER}/sync-state.json`;
const TMP = `${PLUGIN_FOLDER}/sync-state.json.tmp`;

interface MockAdapter {
	exists: Mock;
	read: Mock;
	write: Mock;
	rename: Mock;
}

function makeAdapter(): MockAdapter {
	return {
		exists: vi.fn(),
		read: vi.fn(),
		write: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
	};
}

function asAdapter(mock: MockAdapter): StateAdapter {
	return mock as unknown as StateAdapter;
}

function makeLogger(): Logger & { warns: string[]; infos: string[] } {
	const warns: string[] = [];
	const infos: string[] = [];
	return {
		warns,
		infos,
		warn(event: string) { warns.push(event); return Promise.resolve(); },
		info(event: string) { infos.push(event); return Promise.resolve(); },
	};
}

function makeState(): SyncState {
	return {
		schemaVersion: 1,
		lastSyncCommitSha: 'abc123deadbeef',
		lastSyncAt: '2026-04-28T00:00:00.000Z',
		files: {
			'notes/hello.md': {
				path: 'notes/hello.md',
				blobSha: 'deadbeef1234',
				contentHash: 'sha256ofcontent',
				size: 100,
				isBinary: false,
			},
		},
	};
}

describe('StateStore', () => {
	test('absence: load() returns null when neither file exists', async () => {
		const adapter = makeAdapter();
		adapter.exists.mockResolvedValue(false);
		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, makeLogger());
		expect(await store.load()).toBeNull();
	});

	test('round-trip: save() then load() returns an equal state', async () => {
		const adapter = makeAdapter();
		let stored = '';
		adapter.write.mockImplementation((_path: string, content: string) => {
			stored = content;
			return Promise.resolve();
		});
		adapter.exists.mockImplementation((path: string) =>
			Promise.resolve(path === CANONICAL),
		);
		adapter.read.mockImplementation(() => Promise.resolve(stored));

		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, makeLogger());
		const state = makeState();
		await store.save(state);
		const loaded = await store.load();
		expect(loaded).toEqual(state);
	});

	test('save: writes to .tmp before rename', async () => {
		const adapter = makeAdapter();
		const callOrder: string[] = [];
		adapter.write.mockImplementation((path: string) => {
			callOrder.push(`write:${path}`);
			return Promise.resolve();
		});
		adapter.rename.mockImplementation((from: string, to: string) => {
			callOrder.push(`rename:${from}->${to}`);
			return Promise.resolve();
		});

		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, makeLogger());
		await store.save(makeState());

		expect(callOrder).toEqual([
			`write:${TMP}`,
			`rename:${TMP}->${CANONICAL}`,
		]);
	});

	test('recovery: .tmp exists but canonical does not — loads tmp, emits state.recover, renames', async () => {
		const adapter = makeAdapter();
		const state = makeState();
		adapter.exists.mockImplementation((path: string) =>
			Promise.resolve(path === TMP),
		);
		adapter.read.mockResolvedValue(JSON.stringify(state));

		const logger = makeLogger();
		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, logger);
		const loaded = await store.load();

		expect(loaded).toEqual(state);
		expect(adapter.rename).toHaveBeenCalledWith(TMP, CANONICAL);
		expect(logger.infos).toContain('state.recover');
	});

	test('recovery: read error on .tmp returns null and logs state.corrupt', async () => {
		const adapter = makeAdapter();
		adapter.exists.mockImplementation((path: string) =>
			Promise.resolve(path === TMP),
		);
		adapter.read.mockRejectedValue(new Error('fs error'));

		const logger = makeLogger();
		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, logger);
		expect(await store.load()).toBeNull();
		expect(logger.warns).toContain('state.corrupt');
	});

	test('both files exist: reads canonical and ignores .tmp', async () => {
		const adapter = makeAdapter();
		const state = makeState();
		adapter.exists.mockResolvedValue(true);
		adapter.read.mockImplementation((path: string) => {
			if (path === CANONICAL) return Promise.resolve(JSON.stringify(state));
			return Promise.reject(new Error('should not read .tmp'));
		});

		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, makeLogger());
		const loaded = await store.load();

		expect(loaded).toEqual(state);
		expect(adapter.read).toHaveBeenCalledWith(CANONICAL);
		expect(adapter.read).not.toHaveBeenCalledWith(TMP);
	});

	test('corrupt JSON: load() returns null and logs state.corrupt', async () => {
		const adapter = makeAdapter();
		adapter.exists.mockImplementation((path: string) =>
			Promise.resolve(path === CANONICAL),
		);
		adapter.read.mockResolvedValue('{ not valid json !!!');

		const logger = makeLogger();
		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, logger);
		expect(await store.load()).toBeNull();
		expect(logger.warns).toContain('state.corrupt');
	});

	test('schema mismatch: load() returns null and logs state.schema-mismatch', async () => {
		const adapter = makeAdapter();
		const badState = { ...makeState(), schemaVersion: 99 };
		adapter.exists.mockImplementation((path: string) =>
			Promise.resolve(path === CANONICAL),
		);
		adapter.read.mockResolvedValue(JSON.stringify(badState));

		const logger = makeLogger();
		const store = new StateStore(asAdapter(adapter), PLUGIN_FOLDER, logger);
		expect(await store.load()).toBeNull();
		expect(logger.warns).toContain('state.schema-mismatch');
	});
});

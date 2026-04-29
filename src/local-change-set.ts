import { FileScanner } from './file-scanner';
import { sha256 } from './hash';
import { BINARY_EXTENSIONS } from './constants';
import type { VaultAdapter, LocalChange } from './sync-engine-types';
import type { SyncState } from './state-store';
import type { Settings } from './settings';

export async function buildLocalChangeSet(
	vault: VaultAdapter,
	state: SyncState,
	settings: Settings,
): Promise<Map<string, LocalChange>> {
	const scanner = new FileScanner(vault, {
		includeObsidianConfig: settings.includeObsidianConfig,
		userExcludePatterns: settings.excludePatterns,
	});

	const paths = await scanner.scan();
	const visited = new Set(paths);
	const result = new Map<string, LocalChange>();
	const limitBytes = settings.perFileSizeLimitMb * 1024 * 1024;

	for (const path of paths) {
		const dotIndex = path.lastIndexOf('.');
		const isBinary = dotIndex !== -1 && BINARY_EXTENSIONS.has(path.slice(dotIndex));

		let bytes: ArrayBuffer;
		if (isBinary) {
			bytes = await vault.readBinary(path);
		} else {
			const encoded = new TextEncoder().encode(await vault.readText(path));
			bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
		}

		if (bytes.byteLength > limitBytes) continue;

		const contentHash = await sha256(bytes);
		const size = bytes.byteLength;
		const existing = state.files[path];

		if (!existing) {
			result.set(path, { path, type: 'added', contentHash, bytes, size, isBinary });
		} else if (existing.contentHash !== contentHash) {
			result.set(path, { path, type: 'modified', contentHash, bytes, size, isBinary });
		}
		// else unchanged — omit from result
	}

	// Deletions: paths in state not visited during the scan
	for (const path of Object.keys(state.files)) {
		if (!visited.has(path)) {
			const record = state.files[path];
			result.set(path, {
				path,
				type: 'deleted',
				contentHash: '',
				size: 0,
				isBinary: record.isBinary,
			});
		}
	}

	return result;
}

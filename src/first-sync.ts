import { FileScanner } from './file-scanner';
import { sha256, gitBlobSha1 } from './hash';
import { BINARY_EXTENSIONS } from './constants';
import type { VaultAdapter, LocalChange, RemoteChange, FirstSyncSummary, ConflictItem } from './sync-engine-types';
import type { Settings } from './settings';

export async function buildLocalInventory(
	vault: VaultAdapter,
	settings: Settings,
): Promise<Map<string, LocalChange>> {
	const scanner = new FileScanner(vault, {
		includeObsidianConfig: settings.includeObsidianConfig,
		userExcludePatterns: settings.excludePatterns,
	});

	const paths = await scanner.scan();
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
		result.set(path, { path, type: 'added', contentHash, bytes, size: bytes.byteLength, isBinary });
	}

	return result;
}

export async function buildFirstSyncSummary(
	localInventory: Map<string, LocalChange>,
	remoteTree: Map<string, RemoteChange>,
): Promise<FirstSyncSummary> {
	const localOnly: string[] = [];
	const remoteOnly: string[] = [];
	const identical: string[] = [];
	const conflicts: ConflictItem[] = [];

	const allPaths = new Set([...localInventory.keys(), ...remoteTree.keys()]);

	for (const path of allPaths) {
		const local = localInventory.get(path);
		const remote = remoteTree.get(path);

		if (local && !remote) {
			localOnly.push(path);
		} else if (!local && remote) {
			remoteOnly.push(path);
		} else if (local && remote) {
			const localBlobSha = local.bytes !== undefined
				? await gitBlobSha1(local.bytes)
				: null;
			if (localBlobSha !== null && localBlobSha === remote.blobSha) {
				identical.push(path);
			} else {
				conflicts.push({
					path,
					action: 'conflict',
					local: 'added',
					remote: 'added',
					isBinary: local.isBinary,
					localSize: local.size,
					remoteSize: remote.size,
					remoteBlobSha: remote.blobSha,
				});
			}
		}
	}

	return { localOnly, remoteOnly, identical, conflicts };
}

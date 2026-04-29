import type { GitHubClient, TreeItem } from './github-client';
import type { SyncState } from './state-store';
import type { RemoteChange } from './sync-engine-types';
import { BINARY_EXTENSIONS } from './constants';

export async function buildRemoteChangeSet(
	client: GitHubClient,
	owner: string,
	repo: string,
	treeSha: string,
	state: SyncState,
): Promise<Map<string, RemoteChange>> {
	const blobs = await fetchAllBlobs(client, owner, repo, treeSha);

	const result = new Map<string, RemoteChange>();
	const remotePathSet = new Set<string>();

	for (const item of blobs) {
		const { path } = item;
		remotePathSet.add(path);

		const dotIndex = path.lastIndexOf('.');
		const isBinary = dotIndex !== -1 && BINARY_EXTENSIONS.has(path.slice(dotIndex));
		const size = item.size ?? 0;
		const existing = state.files[path];

		if (!existing) {
			result.set(path, { path, type: 'added', blobSha: item.sha, size, isBinary });
		} else if (existing.blobSha !== item.sha) {
			result.set(path, { path, type: 'modified', blobSha: item.sha, size, isBinary });
		}
		// else unchanged — omit from result
	}

	// Deletions: paths in state absent from the remote tree
	for (const path of Object.keys(state.files)) {
		if (!remotePathSet.has(path)) {
			const record = state.files[path];
			result.set(path, { path, type: 'deleted', size: 0, isBinary: record.isBinary });
		}
	}

	return result;
}

async function fetchAllBlobs(
	client: GitHubClient,
	owner: string,
	repo: string,
	treeSha: string,
): Promise<TreeItem[]> {
	const response = await client.getTree(owner, repo, treeSha, true);

	if (!response.truncated) {
		return response.tree.filter((item) => item.type === 'blob');
	}

	// Truncated: fall back to non-recursive per-subtree walk.
	// Each queue entry carries the sha to fetch and its full path prefix.
	const blobs: TreeItem[] = [];
	const queue: Array<{ sha: string; prefix: string }> = [{ sha: treeSha, prefix: '' }];
	const visited = new Set<string>();

	while (queue.length > 0) {
		const { sha, prefix } = queue.shift()!;
		if (visited.has(sha)) continue;
		visited.add(sha);

		const subtree = await client.getTree(owner, repo, sha, false);

		for (const item of subtree.tree) {
			const fullPath = prefix ? `${prefix}/${item.path}` : item.path;
			if (item.type === 'blob') {
				blobs.push({ ...item, path: fullPath });
			} else if (item.type === 'tree' && !visited.has(item.sha)) {
				queue.push({ sha: item.sha, prefix: fullPath });
			}
		}
	}

	return blobs;
}

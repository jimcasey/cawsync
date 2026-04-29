import { SELF_EXCLUDED_PATHS } from './constants';
import type { VaultAdapter } from './sync-engine-types';

export function parseGitignorePatterns(content: string): string[] {
	return content
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
}

export function matchesGlob(pattern: string, path: string): boolean {
	// Trailing slash means "match this directory and everything inside it"
	const normalized = pattern.endsWith('/') ? pattern + '**' : pattern;
	// Patterns with no slash match against the basename only
	const hasSlash = normalized.includes('/');
	const subject = hasSlash ? path : (path.split('/').pop() ?? path);

	let regex = '';
	for (let i = 0; i < normalized.length; i++) {
		const ch = normalized[i];
		if (ch === '*' && i + 1 < normalized.length && normalized[i + 1] === '*') {
			if (i + 2 < normalized.length && normalized[i + 2] === '/') {
				// **/ matches zero or more directory segments
				regex += '(?:.+/)?';
				i += 2;
			} else {
				// ** matches anything including path separators
				regex += '.*';
				i++;
			}
		} else if (ch === '*') {
			regex += '[^/]*';
		} else if (ch === '?') {
			regex += '[^/]';
		} else {
			regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}

	return new RegExp('^' + regex + '$').test(subject);
}

export function isExcluded(path: string, patterns: readonly string[]): boolean {
	return patterns.some(pattern => matchesGlob(pattern, path));
}

export interface FileScannerConfig {
	includeObsidianConfig: boolean;
	userExcludePatterns: string[];
}

export class FileScanner {
	constructor(
		private readonly adapter: VaultAdapter,
		private readonly config: FileScannerConfig,
	) {}

	async scan(): Promise<string[]> {
		const exclusions: string[] = [...SELF_EXCLUDED_PATHS];

		if (await this.adapter.exists('.gitignore')) {
			const content = await this.adapter.readText('.gitignore');
			exclusions.push(...parseGitignorePatterns(content));
		}

		exclusions.push(...this.config.userExcludePatterns);

		const candidates: string[] = [];

		for (const path of await this.adapter.listFiles()) {
			if (!isExcluded(path, exclusions)) {
				candidates.push(path);
			}
		}

		if (this.config.includeObsidianConfig) {
			await this.walkDirectory('.obsidian', candidates, exclusions);
		}

		return candidates;
	}

	private async walkDirectory(
		dir: string,
		results: string[],
		exclusions: string[],
	): Promise<void> {
		const { files, dirs } = await this.adapter.listDirectory(dir);

		for (const fileName of files) {
			const path = `${dir}/${fileName}`;
			if (!isExcluded(path, exclusions)) {
				results.push(path);
			}
		}

		for (const dirName of dirs) {
			// Hard-exclude .git/ at the directory level — never descend into it
			if (dirName === '.git') continue;
			await this.walkDirectory(`${dir}/${dirName}`, results, exclusions);
		}
	}
}

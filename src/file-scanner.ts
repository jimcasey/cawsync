import { SELF_EXCLUDED_PATHS } from './constants';
import type { VaultAdapter } from './sync-engine-types';

export function parseGitignorePatterns(content: string): string[] {
	return content
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
}

interface CompiledGlob {
	regex: RegExp;
	hasSlash: boolean;
}

const globCache = new Map<string, CompiledGlob>();

function compileGlob(pattern: string): CompiledGlob {
	// Trailing slash means "match this directory and everything inside it"
	const normalized = pattern.endsWith('/') ? pattern + '**' : pattern;
	// Patterns with no slash match against the basename only
	const hasSlash = normalized.includes('/');

	let regexStr = '';
	for (let i = 0; i < normalized.length; i++) {
		const ch = normalized[i];
		if (ch === '*' && i + 1 < normalized.length && normalized[i + 1] === '*') {
			if (i + 2 < normalized.length && normalized[i + 2] === '/') {
				// **/ matches zero or more directory segments
				regexStr += '(?:.+/)?';
				i += 2;
			} else {
				// ** matches anything including path separators
				regexStr += '.*';
				i++;
			}
		} else if (ch === '*') {
			regexStr += '[^/]*';
		} else if (ch === '?') {
			regexStr += '[^/]';
		} else {
			regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}

	return { regex: new RegExp('^' + regexStr + '$'), hasSlash };
}

export function matchesGlob(pattern: string, path: string): boolean {
	let compiled = globCache.get(pattern);
	if (!compiled) {
		compiled = compileGlob(pattern);
		globCache.set(pattern, compiled);
	}
	const subject = compiled.hasSlash ? path : (path.split('/').pop() ?? path);
	return compiled.regex.test(subject);
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

		// Use a Set to prevent duplicates if a path appears in both listFiles() and the adapter walk
		const candidates = new Set<string>();

		for (const path of await this.adapter.listFiles()) {
			if (!isExcluded(path, exclusions)) {
				candidates.add(path);
			}
		}

		if (this.config.includeObsidianConfig) {
			await this.walkDirectory('.obsidian', candidates, exclusions);
		}

		return [...candidates];
	}

	private async walkDirectory(
		dir: string,
		results: Set<string>,
		exclusions: string[],
	): Promise<void> {
		const { files, dirs } = await this.adapter.listDirectory(dir);

		for (const fileName of files) {
			const path = `${dir}/${fileName}`;
			if (!isExcluded(path, exclusions)) {
				results.add(path);
			}
		}

		for (const dirName of dirs) {
			// Hard-exclude .git/ at the directory level — never descend into it
			if (dirName === '.git') continue;
			await this.walkDirectory(`${dir}/${dirName}`, results, exclusions);
		}
	}
}

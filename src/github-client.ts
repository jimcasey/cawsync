import { requestUrl } from 'obsidian';
import { PLUGIN_ID } from './constants';

const GITHUB_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_RETRIES = 3;
const NETWORK_RETRY_MS = 2000;

export class GHAuthError extends Error {
	override readonly name = 'GHAuthError';
}

export class GHNotFoundError extends Error {
	override readonly name = 'GHNotFoundError';
}

export class GHRateLimitError extends Error {
	override readonly name = 'GHRateLimitError';
	readonly retryAfterMs: number;
	constructor(message: string, retryAfterMs: number) {
		super(message);
		this.retryAfterMs = retryAfterMs;
	}
}

export class GHFastForwardError extends Error {
	override readonly name = 'GHFastForwardError';
}

export class GHNetworkError extends Error {
	override readonly name = 'GHNetworkError';
}

export class GHServerError extends Error {
	override readonly name = 'GHServerError';
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export interface GHLogger {
	warn(event: string, fields?: Record<string, unknown>): Promise<void>;
}

interface RequestOptions {
	body?: unknown;
	accept?: string;
}

// Encodes an ArrayBuffer to base64 using chunked processing to avoid the
// spread-argument stack overflow that btoa(String.fromCharCode(...largeArray)) hits for >~65K bytes.
export function encodeBase64Chunked(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK = 0x8000; // 32 KB chunks
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += CHUNK) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
	}
	return btoa(parts.join(''));
}

export class GitHubClient {
	private readonly getPat: () => string;
	private readonly getOwner: () => string;
	private readonly getRepo: () => string;
	private readonly version: string;
	private readonly logger: GHLogger | null;
	private readonly doSleep: (ms: number) => Promise<void>;

	constructor(
		getPat: () => string,
		getOwner: () => string,
		getRepo: () => string,
		version: string,
		logger: GHLogger | null = null,
		sleep?: (ms: number) => Promise<void>,
	) {
		this.getPat = getPat;
		this.getOwner = getOwner;
		this.getRepo = getRepo;
		this.version = version;
		this.logger = logger;
		this.doSleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	private async request(
		method: string,
		path: string,
		options: RequestOptions = {},
	): Promise<unknown> {
		const url = `${GITHUB_API_BASE}${path}`;
		const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;

		let rateRetries = 0;
		let serverRetries = 0;
		let networkRetried = false;

		for (;;) {
			const pat = this.getPat();
			const headers: Record<string, string> = {
				Authorization: `Bearer ${pat}`,
				Accept: options.accept ?? 'application/vnd.github+json',
				'X-GitHub-Api-Version': API_VERSION,
				'User-Agent': `obsidian-${PLUGIN_ID}/${this.version}`,
			};
			if (bodyStr !== undefined) {
				headers['Content-Type'] = 'application/json';
			}

			let response;
			try {
				response = await requestUrl({
					url,
					method,
					headers,
					body: bodyStr,
					throw: false,
				});
			} catch (err) {
				if (networkRetried) {
					throw new GHNetworkError(
						`Network error: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				networkRetried = true;
				await this.doSleep(NETWORK_RETRY_MS);
				continue;
			}

			const remaining = parseInt(response.headers['x-ratelimit-remaining'] ?? '-1', 10);
			const resetUnix = parseInt(response.headers['x-ratelimit-reset'] ?? '0', 10);

			if (remaining > 0 && remaining < 100) {
				await this.logger?.warn('gh.ratelimit.warn', { remaining, resetAt: resetUnix });
			}

			const { status } = response;

			if (status >= 200 && status < 300) {
				if (remaining === 0) {
					const resetAt = new Date(resetUnix * 1000).toISOString();
					throw new GHRateLimitError(
						`GitHub rate limit exhausted. Resets at ${resetAt}.`,
						Math.max(0, resetUnix * 1000 - Date.now()),
					);
				}
				try {
					return response.json as unknown;
				} catch {
					return response.text;
				}
			}

			const safeBody = this.scrubPat(response.text ?? '').slice(0, 200);

			if (status === 401) {
				throw new GHAuthError(`Authentication failed. Check your token. (${safeBody})`);
			}

			if (status === 404) {
				throw new GHNotFoundError(
					`Not found: ${path}. The resource may not exist or your token may lack permissions.`,
				);
			}

			if (status === 429 || (status === 403 && 'retry-after' in response.headers)) {
				const retryAfterSec = parseInt(response.headers['retry-after'] ?? '60', 10);
				const retryAfterMs = Number.isNaN(retryAfterSec) ? 60_000 : retryAfterSec * 1000;
				if (rateRetries >= MAX_RETRIES) {
					throw new GHRateLimitError(
						`Rate limit exceeded after ${MAX_RETRIES} retries. Retry after ${retryAfterMs}ms.`,
						retryAfterMs,
					);
				}
				await this.doSleep(this.backoff(rateRetries, retryAfterMs));
				rateRetries++;
				continue;
			}

			if (status === 422) {
				throw new GHFastForwardError(
					`Ref update rejected (fast-forward required). Another client may have pushed to the branch.`,
				);
			}

			if (status >= 500) {
				if (serverRetries >= MAX_RETRIES) {
					throw new GHServerError(`Server error ${status}: ${safeBody}`, status);
				}
				await this.doSleep(this.backoff(serverRetries, 1000));
				serverRetries++;
				continue;
			}

			throw new GHServerError(`Unexpected status ${status}: ${safeBody}`, status);
		}
	}

	private scrubPat(text: string): string {
		const pat = this.getPat();
		return pat ? text.split(pat).join('[REDACTED]') : text;
	}

	private backoff(retryCount: number, baseMs: number): number {
		const expo = Math.min(baseMs * 2 ** retryCount, 60_000);
		return expo + Math.random() * 0.1 * expo;
	}
}

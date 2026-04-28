import { vi, describe, test, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
}));

import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import {
	GitHubClient,
	GHAuthError,
	GHNotFoundError,
	GHRateLimitError,
	GHFastForwardError,
	GHNetworkError,
	GHServerError,
	encodeBase64Chunked,
} from './github-client';

const mockRequestUrl = requestUrl as Mock;

// Access private `request` without `any`
interface TestableClient {
	request(
		method: string,
		path: string,
		options?: { accept?: string; body?: unknown },
	): Promise<unknown>;
}

function call(
	client: GitHubClient,
	method: string,
	path: string,
	options?: { accept?: string; body?: unknown },
): Promise<unknown> {
	return (client as unknown as TestableClient).request(method, path, options);
}

const PAT = 'ghp_supersecrettoken123';
const OWNER = 'testowner';
const REPO = 'testrepo';
const VERSION = '0.0.1';

function makeResponse(
	status: number,
	body: unknown = {},
	headers: Record<string, string> = {},
): RequestUrlResponse {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	return {
		status,
		headers: { 'content-type': 'application/json', ...headers },
		text,
		json: body,
		arrayBuffer: new ArrayBuffer(0),
	};
}

function makeClient(mockSleep?: Mock): { client: GitHubClient; sleep: Mock } {
	const sleep = mockSleep ?? vi.fn().mockResolvedValue(undefined);
	const client = new GitHubClient(
		() => PAT,
		() => OWNER,
		() => REPO,
		VERSION,
		null,
		sleep,
	);
	return { client, sleep };
}

describe('GitHubClient', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	describe('headers', () => {
		test('injects Authorization, Accept, X-GitHub-Api-Version, and User-Agent on every request', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(200, { ref: 'refs/heads/main' }));
			const { client } = makeClient();

			await call(client, 'GET', '/repos/testowner/testrepo/branches/main');

			const param = mockRequestUrl.mock.calls[0][0] as { headers: Record<string, string> };
			expect(param.headers['Authorization']).toBe(`Bearer ${PAT}`);
			expect(param.headers['Accept']).toBe('application/vnd.github+json');
			expect(param.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
			expect(param.headers['User-Agent']).toBe('obsidian-jackdaw/0.0.1');
		});

		test('overrides Accept header when accept option is provided', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(200, 'raw content'));
			const { client } = makeClient();

			await call(client, 'GET', '/repos/testowner/testrepo/git/blobs/abc123', {
				accept: 'application/vnd.github.raw',
			});

			const param = mockRequestUrl.mock.calls[0][0] as { headers: Record<string, string> };
			expect(param.headers['Accept']).toBe('application/vnd.github.raw');
		});

		test('sets Content-Type: application/json and serializes body when body option is provided', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(200, {}));
			const { client } = makeClient();

			await call(client, 'POST', '/repos/testowner/testrepo/git/blobs', {
				body: { content: 'aGVsbG8=', encoding: 'base64' },
			});

			const param = mockRequestUrl.mock.calls[0][0] as {
				headers: Record<string, string>;
				body: string;
			};
			expect(param.headers['Content-Type']).toBe('application/json');
			expect(JSON.parse(param.body)).toEqual({ content: 'aGVsbG8=', encoding: 'base64' });
		});

		test('reads PAT fresh on each retry so settings changes take effect', async () => {
			let n = 0;
			const getPat = vi.fn(() => `ghp_token_${++n}`);
			const sleep = vi.fn().mockResolvedValue(undefined);
			const client = new GitHubClient(getPat, () => OWNER, () => REPO, VERSION, null, sleep);

			// Return 429 twice then succeed
			mockRequestUrl
				.mockResolvedValueOnce(makeResponse(429, {}, { 'retry-after': '1' }))
				.mockResolvedValueOnce(makeResponse(200, {}));

			await call(client, 'GET', '/test');

			const firstCall = mockRequestUrl.mock.calls[0][0] as { headers: Record<string, string> };
			const secondCall = mockRequestUrl.mock.calls[1][0] as { headers: Record<string, string> };
			expect(firstCall.headers['Authorization']).not.toBe(secondCall.headers['Authorization']);
		});
	});

	describe('error handling', () => {
		test('401 raises GHAuthError and never retries', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(401, { message: 'Bad credentials' }));
			const { client } = makeClient();

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHAuthError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		test('404 raises GHNotFoundError and never retries', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(404, { message: 'Not Found' }));
			const { client } = makeClient();

			await expect(call(client, 'GET', '/repos/testowner/testrepo/git/refs/heads/missing')).rejects.toThrow(GHNotFoundError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		test('422 raises GHFastForwardError and never retries', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(422, { message: 'Update is not a fast forward' }));
			const { client } = makeClient();

			await expect(call(client, 'PATCH', '/repos/testowner/testrepo/git/refs/heads/main')).rejects.toThrow(GHFastForwardError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		test('429 with Retry-After: 30 retries with backoff up to 3 times then raises GHRateLimitError', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(429, { message: 'rate limit' }, { 'retry-after': '30' }));
			const { client, sleep } = makeClient();

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHRateLimitError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
			expect(sleep).toHaveBeenCalledTimes(3);
		});

		test('403 with retry-after header is treated as secondary rate limit', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(403, { message: 'secondary rate limit' }, { 'retry-after': '60' }));
			const { client } = makeClient();

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHRateLimitError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(4);
		});

		test('403 without retry-after header does not trigger rate-limit retry', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(403, { message: 'forbidden' }));
			const { client } = makeClient();

			// Falls through to GHServerError (unexpected 4xx that isn't explicitly handled)
			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHServerError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		test('500 retries up to 3 times then raises GHServerError', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(500, { message: 'Internal Server Error' }));
			const { client, sleep } = makeClient();

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHServerError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
			expect(sleep).toHaveBeenCalledTimes(3);
		});

		test('500 succeeds on second attempt without raising', async () => {
			const { client } = makeClient();
			mockRequestUrl
				.mockResolvedValueOnce(makeResponse(500, {}))
				.mockResolvedValueOnce(makeResponse(200, { ok: true }));

			const result = await call(client, 'GET', '/test');
			expect(result).toEqual({ ok: true });
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		test('network error retries once then raises GHNetworkError', async () => {
			const { client } = makeClient();
			mockRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHNetworkError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		test('network error recovers on second attempt', async () => {
			const { client } = makeClient();
			mockRequestUrl
				.mockRejectedValueOnce(new Error('network failure'))
				.mockResolvedValueOnce(makeResponse(200, { data: 'ok' }));

			const result = await call(client, 'GET', '/test');
			expect(result).toEqual({ data: 'ok' });
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});
	});

	describe('PAT scrubbing', () => {
		test('PAT does not appear in GHAuthError message when echoed in 401 body', async () => {
			const body = `{"message":"Bad credentials","token":"${PAT}","hint":"use ${PAT}"}`;
			mockRequestUrl.mockResolvedValue({
				status: 401,
				headers: {},
				text: body,
				json: body,
				arrayBuffer: new ArrayBuffer(0),
			});
			const { client } = makeClient();

			const err = await call(client, 'GET', '/test').catch((e: unknown) => e);
			expect(err).toBeInstanceOf(GHAuthError);
			expect((err as GHAuthError).message).not.toContain(PAT);
			expect((err as GHAuthError).message).toContain('[REDACTED]');
		});
	});

	describe('rate limit headers', () => {
		test('emits gh.ratelimit.warn when X-RateLimit-Remaining is below 100', async () => {
			mockRequestUrl.mockResolvedValue(
				makeResponse(200, { ok: true }, { 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '9999999999' }),
			);
			const warns: { event: string; fields?: Record<string, unknown> }[] = [];
			const logger = { warn: vi.fn(async (event: string, fields?: Record<string, unknown>) => { warns.push({ event, fields }); }) };
			const sleep = vi.fn().mockResolvedValue(undefined);
			const client = new GitHubClient(() => PAT, () => OWNER, () => REPO, VERSION, logger, sleep);

			await call(client, 'GET', '/test');

			expect(warns.some((w) => w.event === 'gh.ratelimit.warn')).toBe(true);
			const warn = warns.find((w) => w.event === 'gh.ratelimit.warn');
			expect(warn?.fields?.remaining).toBe(42);
		});

		test('raises GHRateLimitError immediately when X-RateLimit-Remaining is 0', async () => {
			mockRequestUrl.mockResolvedValue(
				makeResponse(200, { ok: true }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' }),
			);
			const { client } = makeClient();

			await expect(call(client, 'GET', '/test')).rejects.toThrow(GHRateLimitError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});
	});

	describe('GHRateLimitError retryAfterMs', () => {
		test('retryAfterMs reflects Retry-After header in seconds converted to ms', async () => {
			mockRequestUrl.mockResolvedValue(makeResponse(429, {}, { 'retry-after': '30' }));
			const { client } = makeClient();

			const err = await call(client, 'GET', '/test').catch((e: unknown) => e);
			expect(err).toBeInstanceOf(GHRateLimitError);
			expect((err as GHRateLimitError).retryAfterMs).toBe(30_000);
		});
	});
});

describe('encodeBase64Chunked', () => {
	test('produces same output as btoa for small inputs', () => {
		const inputs = ['hello world', '', 'abc', 'The quick brown fox'];
		for (const s of inputs) {
			const buf = new TextEncoder().encode(s).buffer;
			expect(encodeBase64Chunked(buf)).toBe(btoa(s));
		}
	});

	test('handles a buffer larger than 1 MB without throwing', () => {
		const buf = new Uint8Array(1.1 * 1024 * 1024).fill(65).buffer; // 1.1 MB of 'A'
		expect(() => encodeBase64Chunked(buf)).not.toThrow();
		// All 'A' bytes → base64 should consist only of 'Q' and '='
		const result = encodeBase64Chunked(buf);
		expect(result.length).toBeGreaterThan(0);
		expect(/^[A-Za-z0-9+/]+=*$/.test(result)).toBe(true);
	});

	test('empty buffer produces empty base64 string', () => {
		expect(encodeBase64Chunked(new ArrayBuffer(0))).toBe('');
	});
});

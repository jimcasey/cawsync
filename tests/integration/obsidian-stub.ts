// Stub for the `obsidian` module used during integration tests. Vitest aliases
// `obsidian` → this file (see vitest.integration.config.ts) so `GitHubClient`,
// which imports `requestUrl` from obsidian, can run in plain Node against the
// real GitHub API.
//
// `requestUrl` is the only API exercised in the integration code paths; other
// obsidian symbols (App, TFile, etc.) are not imported by the sync engine, so
// stubbing just this is sufficient.

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string>;
	json: unknown;
	status: number;
	text: string;
}

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	const res = await fetch(param.url, {
		method: param.method ?? 'GET',
		headers: param.headers,
		body: param.body as BodyInit | undefined,
	});

	const arrayBuffer = await res.arrayBuffer();
	const text = new TextDecoder().decode(arrayBuffer);

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		// Non-JSON responses (e.g. raw blob bodies) leave json undefined.
	}

	const headers: Record<string, string> = {};
	res.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});

	return { status: res.status, headers, text, json, arrayBuffer };
}

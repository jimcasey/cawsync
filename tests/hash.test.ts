import { expect, test } from 'vitest';
import { sha256, gitBlobSha1 } from '../src/hash';

function fromString(s: string): ArrayBuffer {
	return new TextEncoder().encode(s).buffer;
}

function fromBytes(...bytes: number[]): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

test('sha256 of empty bytes', async () => {
	expect(await sha256(new ArrayBuffer(0))).toBe(
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
	);
});

test('sha256 of "hello world"', async () => {
	expect(await sha256(fromString('hello world'))).toBe(
		'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
	);
});

test('sha256 of small binary buffer', async () => {
	expect(await sha256(fromBytes(0x00, 0x01, 0x02, 0xff))).toBe(
		'3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56'
	);
});

test('gitBlobSha1 of empty bytes matches git hash-object', async () => {
	expect(await gitBlobSha1(new ArrayBuffer(0))).toBe(
		'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
	);
});

test('gitBlobSha1 of "hello world" matches git hash-object', async () => {
	expect(await gitBlobSha1(fromString('hello world'))).toBe(
		'95d09f2b10159347eece71399a7e2e907ea3df4f'
	);
});

test('gitBlobSha1 of small binary buffer matches git hash-object', async () => {
	expect(await gitBlobSha1(fromBytes(0x00, 0x01, 0x02, 0xff))).toBe(
		'f971a5e28b6c4cb237ca3c7349e33bb600dbc907'
	);
});

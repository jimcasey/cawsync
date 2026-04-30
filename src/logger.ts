import type { DataAdapter } from 'obsidian';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const LOG_FILE = 'sync.log';
const LOG_BACKUP = 'sync.log.1';
const MAX_BYTES = 1024 * 1024; // 1 MB

export class Logger {
	private adapter: DataAdapter;
	private prefix: string;
	private getVerbose: () => boolean;
	private getPat: () => string;

	constructor(
		adapter: DataAdapter,
		prefix: string,
		getVerbose: () => boolean,
		getPat: () => string,
	) {
		this.adapter = adapter;
		this.prefix = prefix;
		this.getVerbose = getVerbose;
		this.getPat = getPat;
	}

	// Never log file contents.
	debug(event: string, fields?: Fields): Promise<void> {
		if (!this.getVerbose()) return Promise.resolve();
		return this.emit('debug', event, fields);
	}

	// Never log file contents.
	info(event: string, fields?: Fields): Promise<void> {
		return this.emit('info', event, fields);
	}

	// Never log file contents.
	warn(event: string, fields?: Fields): Promise<void> {
		return this.emit('warn', event, fields);
	}

	// Never log file contents.
	error(event: string, fields?: Fields): Promise<void> {
		return this.emit('error', event, fields);
	}

	private async emit(level: Level, event: string, fields?: Fields): Promise<void> {
		const entry = { ts: new Date().toISOString(), level, event, ...fields };
		const line = this.scrub(JSON.stringify(entry)) + '\n';

		const logPath = `${this.prefix}/${LOG_FILE}`;
		const backupPath = `${this.prefix}/${LOG_BACKUP}`;

		if (await this.adapter.exists(logPath)) {
			const stat = await this.adapter.stat(logPath);
			if (stat && stat.size >= MAX_BYTES) {
				if (await this.adapter.exists(backupPath)) {
					await this.adapter.remove(backupPath);
				}
				await this.adapter.rename(logPath, backupPath);
			}
		}

		await this.adapter.append(logPath, line);
	}

	private scrub(line: string): string {
		const pat = this.getPat();
		let result = line;
		if (pat) {
			result = result.split(pat).join('***');
		}
		result = result.replace(/(Authorization:\s*Bearer\s+)[^\s"\\,}]+/gi, '$1***');
		return result;
	}
}

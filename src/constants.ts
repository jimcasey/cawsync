export const PLUGIN_ID = 'cawsync';

export const SELF_EXCLUDED_PATHS: readonly string[] = [
	`.obsidian/plugins/${PLUGIN_ID}/data.json`,
	`.obsidian/plugins/${PLUGIN_ID}/sync-state.json`,
	`.obsidian/plugins/${PLUGIN_ID}/sync-state.json.tmp`,
	`.obsidian/plugins/${PLUGIN_ID}/sync.log`,
	`.obsidian/plugins/${PLUGIN_ID}/sync.log.1`,
];

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.pdf',
	'.mp3',
	'.mp4',
	'.mov',
	'.zip',
	'.icloud',
]);

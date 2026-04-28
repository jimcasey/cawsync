import { Notice, Platform, Plugin } from 'obsidian';

export default class JackdawPlugin extends Plugin {
	async onload(): Promise<void> {
		if (Platform.isAndroidApp) {
			new Notice('Jackdaw: This plugin is not supported on Android. iOS and desktop only.');
			return;
		}

		this.addRibbonIcon('sync', 'Jackdaw: Sync vault', () => {
			new Notice('Sync coming soon');
		});

		this.addCommand({
			id: 'sync-vault',
			name: 'Sync vault',
			callback: () => {
				new Notice('Sync coming soon');
			},
		});
	}

	onunload(): void {}
}

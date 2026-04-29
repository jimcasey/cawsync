import { Notice, Platform, Plugin } from 'obsidian';
import { Settings, DEFAULT_SETTINGS } from './settings';
import { JackdawSettingsTab } from './ui/settings-tab';

export default class JackdawPlugin extends Plugin {
	settings!: Settings;

	async onload(): Promise<void> {
		if (Platform.isAndroidApp) {
			new Notice('Jackdaw: This plugin is not supported on Android. iOS and desktop only.');
			return;
		}

		await this.loadSettings();

		this.addSettingTab(new JackdawSettingsTab(this.app, this));

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

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

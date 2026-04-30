import { App, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings';
import type JackdawPlugin from '../main';

export class JackdawSettingsTab extends PluginSettingTab {
	plugin: JackdawPlugin;

	constructor(app: App, plugin: JackdawPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Connection
		containerEl.createEl('h2', { text: 'Connection' });

		new Setting(containerEl)
			.setName('Repository owner')
			.setDesc('GitHub username or organization that owns the repository.')
			.addText(text =>
				text
					.setPlaceholder('owner')
					.setValue(this.plugin.settings.owner)
					.onChange(async value => {
						this.plugin.settings.owner = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Repository name')
			.setDesc('Name of the GitHub repository to sync with.')
			.addText(text =>
				text
					.setPlaceholder('my-vault')
					.setValue(this.plugin.settings.repo)
					.onChange(async value => {
						this.plugin.settings.repo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Branch')
			.setDesc('Branch to sync against.')
			.addText(text =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.branch)
					.setValue(this.plugin.settings.branch)
					.onChange(async value => {
						this.plugin.settings.branch = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Personal access token')
			.setDesc(
				'GitHub fine-grained PAT scoped to one repo with an expiry. ' +
				'Obsidian Sync replicates data.json (which stores this token) end-to-end-encrypted to every device.'
			)
			.addText(text => {
				text
					.setPlaceholder('github_pat_…')
					.setValue(this.plugin.settings.pat)
					.onChange(async value => {
						this.plugin.settings.pat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		// Sync behavior
		containerEl.createEl('h2', { text: 'Sync behavior' });

		new Setting(containerEl)
			.setName('Conflict policy')
			.setDesc('How to handle files modified both locally and remotely since the last sync.')
			.addDropdown(drop =>
				drop
					.addOption('always-ask', 'Always ask')
					.addOption('always-prefer-local', 'Always prefer local')
					.addOption('always-prefer-remote', 'Always prefer remote')
					.setValue(this.plugin.settings.conflictPolicy)
					.onChange(async value => {
						this.plugin.settings.conflictPolicy = value as typeof this.plugin.settings.conflictPolicy;
						await this.plugin.saveSettings();
					})
			);

		const sizeLimitSetting = new Setting(containerEl)
			.setName('Per-file size limit (MB)')
			.setDesc('Files larger than this limit are skipped. Must be a whole number between 0 and 100.')
			.addText(text =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.perFileSizeLimitMb))
					.setValue(String(this.plugin.settings.perFileSizeLimitMb))
					.onChange(async value => {
						if (!/^\d+$/.test(value)) {
							sizeLimitSetting.setDesc('⚠ Enter a whole number between 0 and 100.');
							return;
						}
						const parsed = parseInt(value, 10);
						const clamped = Math.min(parsed, 100);
						if (clamped !== parsed) {
							text.setValue(String(clamped));
						}
						sizeLimitSetting.setDesc('Files larger than this limit are skipped. Must be a whole number between 0 and 100.');
						this.plugin.settings.perFileSizeLimitMb = clamped;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Device name')
			.setDesc('Appears in commit messages. Leave blank to use "Obsidian".')
			.addText(text =>
				text
					.setPlaceholder('Obsidian')
					.setValue(this.plugin.settings.deviceName)
					.onChange(async value => {
						this.plugin.settings.deviceName = value;
						await this.plugin.saveSettings();
					})
			);

		// Inclusion
		containerEl.createEl('h2', { text: 'Inclusion' });

		new Setting(containerEl)
			.setName('Include .obsidian configs')
			.setDesc(
				'Most users do not need this — Obsidian Sync already replicates .obsidian between your devices. ' +
				"Enabling this pushes plugin configs to GitHub. Jackdaw's own data and state files are always excluded."
			)
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.includeObsidianConfig)
					.onChange(async value => {
						this.plugin.settings.includeObsidianConfig = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Exclude patterns')
			.setDesc('One glob per line. Lines starting with # and empty lines are ignored.')
			.addTextArea(area => {
				area
					.setPlaceholder(DEFAULT_SETTINGS.excludePatterns.join('\n'))
					.setValue(this.plugin.settings.excludePatterns.join('\n'))
					.onChange(async value => {
						this.plugin.settings.excludePatterns = value
							.split('\n')
							.map(line => line.trim())
							.filter(line => line.length > 0 && !line.startsWith('#'));
						await this.plugin.saveSettings();
					});
				area.inputEl.rows = 6;
				area.inputEl.style.width = '100%';
			});
	}
}

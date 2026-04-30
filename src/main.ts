import { App, Notice, Platform, Plugin, PluginSettingTab } from 'obsidian';
import { Settings, DEFAULT_SETTINGS } from './settings';
import { JackdawSettingsTab } from './ui/settings-tab';
import { RibbonIcon } from './ui/ribbon';
import { StatusBar } from './ui/status-bar';
import { ConflictResolutionModal } from './ui/modals/conflict-resolution-modal';
import { GitHubClient } from './github-client';
import { Logger } from './logger';
import { ObsidianStateAdapter } from './obsidian-state-adapter';
import { StateStore } from './state-store';
import { ObsidianVaultAdapter } from './obsidian-vault-adapter';
import { SyncEngine } from './sync-engine';
import { PolicyBasedResolver } from './sync-engine-types';
import type { SyncResult } from './sync-engine-types';
import { formatSyncOutcome } from './sync-notice';

export default class JackdawPlugin extends Plugin {
	settings!: Settings;
	private engine?: SyncEngine;
	private ribbon?: RibbonIcon;
	private statusBar?: StatusBar;
	private lastSyncAt: string | null = null;
	private isRunningSync = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		if (Platform.isAndroidApp) {
			this.addSettingTab(new AndroidUnsupportedSettingsTab(this.app, this));
			return;
		}

		const pluginFolder = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

		const logger = new Logger(
			this.app.vault.adapter,
			pluginFolder,
			() => this.settings.verboseLogging,
			() => this.settings.pat,
		);

		const stateStore = new StateStore(
			new ObsidianStateAdapter(this.app.vault.adapter),
			pluginFolder,
			logger,
		);

		const vault = new ObsidianVaultAdapter(this.app);

		const client = new GitHubClient(
			() => this.settings.pat,
			() => this.settings.owner,
			() => this.settings.repo,
			this.manifest.version,
			logger,
		);

		const policyResolver = new PolicyBasedResolver(() => this.settings.conflictPolicy);
		const conflictModal = new ConflictResolutionModal(
			this.app,
			vault,
			client,
			() => ({ owner: this.settings.owner, repo: this.settings.repo }),
		);

		this.engine = new SyncEngine(
			vault,
			client,
			stateStore,
			logger,
			() => this.settings,
			conflictModal,
			policyResolver,
		);

		if (!Platform.isMobileApp) {
			this.statusBar = new StatusBar(this.addStatusBarItem());
			try {
				const initial = await stateStore.load();
				if (initial) {
					this.lastSyncAt = initial.lastSyncAt;
					this.statusBar.setIdle(initial.lastSyncAt);
				}
			} catch {
				// Seeding the status bar is best-effort; sync itself will surface real errors.
			}
		}

		this.addSettingTab(new JackdawSettingsTab(this.app, this, client));

		const trigger = (): void => {
			void this.runSync();
		};

		this.ribbon = new RibbonIcon(this, trigger);

		this.addCommand({
			id: 'sync-vault',
			name: 'Sync with GitHub',
			callback: trigger,
		});
	}

	async runSync(): Promise<void> {
		if (!this.engine) return;
		// Guard at the UI layer: without this, a second click while a sync is in
		// flight would flip the spinner off in its own finally block — even though
		// the first sync is still running.
		if (this.isRunningSync) return;
		this.isRunningSync = true;
		this.statusBar?.setSyncing();
		this.ribbon?.setSyncing();
		try {
			const result = await this.engine.sync();
			this.handleSyncResult(result);
		} finally {
			this.ribbon?.setIdle();
			this.isRunningSync = false;
		}
	}

	private handleSyncResult(result: SyncResult): void {
		const outcome = formatSyncOutcome(
			result,
			() => new Date().toISOString(),
			this.lastSyncAt,
		);

		for (const toast of outcome.toasts) {
			new Notice(toast);
		}

		if (outcome.statusBar.kind === 'idle') {
			if (outcome.statusBar.lastSyncAt !== null) {
				this.lastSyncAt = outcome.statusBar.lastSyncAt;
			}
			this.statusBar?.setIdle(outcome.statusBar.lastSyncAt);
		} else {
			this.statusBar?.setError(outcome.statusBar.message);
		}
	}

	onunload(): void {
		this.statusBar = undefined;
		this.ribbon = undefined;
		this.engine = undefined;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class AndroidUnsupportedSettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: JackdawPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Jackdaw' });
		containerEl.createEl('p', {
			text: 'Jackdaw is not supported on Android. The plugin works on Obsidian desktop and iOS only.',
		});
	}
}

import { Plugin } from 'obsidian';

export class RibbonIcon {
	private el: HTMLElement;

	constructor(plugin: Plugin, onClick: () => void) {
		this.el = plugin.addRibbonIcon('refresh-cw', 'Jackdaw: Sync vault', onClick);
	}

	setSyncing(): void {
		this.el.addClass('jackdaw-syncing');
	}

	setIdle(): void {
		this.el.removeClass('jackdaw-syncing');
	}
}

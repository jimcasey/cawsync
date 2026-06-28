import { Plugin } from 'obsidian';

export class RibbonIcon {
	private el: HTMLElement;

	constructor(plugin: Plugin, onClick: () => void) {
		this.el = plugin.addRibbonIcon('refresh-cw', 'Cawsync: Sync vault', onClick);
	}

	setSyncing(): void {
		this.el.addClass('cawsync-syncing');
	}

	setIdle(): void {
		this.el.removeClass('cawsync-syncing');
	}
}

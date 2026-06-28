export class StatusBar {
	private el: HTMLElement;

	constructor(el: HTMLElement) {
		this.el = el;
		this.setIdle(null);
	}

	setIdle(lastSyncAt: string | null): void {
		if (lastSyncAt === null) {
			this.el.setText('Cawsync: Never synced');
		} else {
			const time = new Date(lastSyncAt).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
			});
			this.el.setText(`Cawsync: Synced ${time}`);
		}
		this.el.removeAttribute('aria-label');
	}

	setSyncing(): void {
		this.el.setText('Cawsync: Syncing…');
		this.el.removeAttribute('aria-label');
	}

	setError(message: string): void {
		this.el.setText('Cawsync: Sync error');
		this.el.setAttribute('aria-label', message);
	}
}

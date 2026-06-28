import { App, Modal, Platform } from 'obsidian';
import type {
	ConflictItem,
	ConflictResolution,
	ConflictResolver,
	VaultAdapter,
} from '../../sync-engine-types';
import type { GitHubClient } from '../../github-client';
import { computeLineDiff } from '../diff';
import { createConflictRow, type ConflictRowContentState, type ConflictRowController } from './conflict-row';
import { computeVirtualWindow } from './virtualized-list';

const COLLAPSED_ROW_HEIGHT = 48;
const LINE_HEIGHT_PX = 20;
const EXPANDED_PADDING_PX = 16;
const FIXED_BLOCK_HEIGHT_PX = 60;
const OVERSCAN = 3;

export interface RepoCoords {
	owner: string;
	repo: string;
}

export class ConflictResolutionModal extends Modal implements ConflictResolver {
	private readonly vault: VaultAdapter;
	private readonly client: GitHubClient;
	private readonly getRepoCoords: () => RepoCoords;

	private conflicts: ConflictItem[] = [];
	private readonly selections = new Map<string, ConflictResolution>();
	private readonly expanded = new Map<string, boolean>();
	private readonly contentCache = new Map<string, ConflictRowContentState>();
	private readonly rowControllers = new Map<string, ConflictRowController>();
	private readonly measuredHeights = new Map<string, number>();

	private listEl: HTMLElement | null = null;
	private spacerEl: HTMLElement | null = null;
	private applyBtn: HTMLButtonElement | null = null;
	private resolvePromise: ((value: Map<string, ConflictResolution> | 'cancel') => void) | null = null;
	private settled = false;
	private rerenderScheduled = false;

	constructor(app: App, vault: VaultAdapter, client: GitHubClient, getRepoCoords: () => RepoCoords) {
		super(app);
		this.vault = vault;
		this.client = client;
		this.getRepoCoords = getRepoCoords;
	}

	resolve(conflicts: ConflictItem[]): Promise<Map<string, ConflictResolution> | 'cancel'> {
		this.conflicts = conflicts;
		this.settled = false;
		this.selections.clear();
		this.expanded.clear();
		this.contentCache.clear();
		this.rowControllers.clear();
		this.measuredHeights.clear();

		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.classList.add('cawsync-conflict-modal');
		if (Platform.isMobileApp) {
			modalEl.classList.add('cawsync-mobile');
		}

		this.titleEl.setText(`Resolve ${this.conflicts.length} conflict${this.conflicts.length === 1 ? '' : 's'}.`);

		this.listEl = contentEl.createDiv({ cls: 'cawsync-conflict-list' });
		this.spacerEl = this.listEl.createDiv({ cls: 'cawsync-conflict-list-spacer' });

		this.listEl.addEventListener('scroll', () => this.renderVisible());

		const footer = contentEl.createDiv({ cls: 'cawsync-conflict-footer' });

		const cancelBtn = footer.createEl('button', { text: 'Cancel sync' });
		cancelBtn.addEventListener('click', () => this.settle('cancel'));

		const applyBtn = footer.createEl('button', { text: 'Apply selections and sync' });
		applyBtn.classList.add('mod-cta');
		applyBtn.addEventListener('click', () => {
			if (this.selections.size === this.conflicts.length) {
				this.settle(new Map(this.selections));
			}
		});
		this.applyBtn = applyBtn;

		this.updateApplyButtonState();
		this.renderVisible();
	}

	onClose(): void {
		if (!this.settled) {
			this.settle('cancel');
		}
		this.contentEl.empty();
		this.modalEl.classList.remove('cawsync-conflict-modal', 'cawsync-mobile');
		for (const controller of this.rowControllers.values()) {
			controller.disconnect();
		}
		this.rowControllers.clear();
		this.measuredHeights.clear();
		this.rerenderScheduled = false;
		this.listEl = null;
		this.spacerEl = null;
		this.applyBtn = null;
	}

	private settle(value: Map<string, ConflictResolution> | 'cancel'): void {
		if (this.settled) return;
		this.settled = true;
		const resolver = this.resolvePromise;
		this.resolvePromise = null;
		this.close();
		resolver?.(value);
	}

	private getRowHeight(index: number): number {
		const item = this.conflicts[index];
		const measured = this.measuredHeights.get(item.path);
		if (measured !== undefined && measured > 0) return measured;
		if (!this.expanded.get(item.path)) {
			return COLLAPSED_ROW_HEIGHT;
		}
		const cached = this.contentCache.get(item.path);
		if (!cached || cached.status === 'loading' || cached.status === 'error' || cached.status === 'binary') {
			return COLLAPSED_ROW_HEIGHT + FIXED_BLOCK_HEIGHT_PX;
		}
		return COLLAPSED_ROW_HEIGHT + EXPANDED_PADDING_PX + cached.lines.length * LINE_HEIGHT_PX;
	}

	private handleHeightChange(path: string, height: number): void {
		if (height <= 0) return;
		if (this.measuredHeights.get(path) === height) return;
		this.measuredHeights.set(path, height);
		if (this.rerenderScheduled) return;
		this.rerenderScheduled = true;
		requestAnimationFrame(() => {
			this.rerenderScheduled = false;
			this.renderVisible();
		});
	}

	private renderVisible(): void {
		if (!this.listEl || !this.spacerEl) return;

		const view = computeVirtualWindow({
			scrollTop: this.listEl.scrollTop,
			viewportHeight: this.listEl.clientHeight,
			itemCount: this.conflicts.length,
			getItemHeight: (i) => this.getRowHeight(i),
			overscan: OVERSCAN,
		});

		this.spacerEl.style.height = `${view.totalHeight}px`;

		const visiblePaths = new Set<string>();
		let cumulative = view.offsetY;

		for (let i = view.startIndex; i < view.endIndex; i++) {
			const item = this.conflicts[i];
			visiblePaths.add(item.path);
			let controller = this.rowControllers.get(item.path);
			if (!controller) {
				controller = createConflictRow({
					item,
					initialResolution: this.selections.get(item.path) ?? null,
					initialExpanded: this.expanded.get(item.path) ?? false,
					onSelect: (resolution) => this.handleSelect(item.path, resolution),
					onToggle: () => this.handleToggle(item),
					onHeightChange: (height) => this.handleHeightChange(item.path, height),
				});
				controller.el.style.position = 'absolute';
				controller.el.style.left = '0';
				controller.el.style.right = '0';
				this.rowControllers.set(item.path, controller);
				this.spacerEl.appendChild(controller.el);
				const cached = this.contentCache.get(item.path);
				if (cached) controller.setContent(cached);
			}
			controller.el.style.top = `${cumulative}px`;
			cumulative += this.getRowHeight(i);
		}

		for (const [path, controller] of this.rowControllers) {
			if (!visiblePaths.has(path)) {
				controller.disconnect();
				controller.el.remove();
				this.rowControllers.delete(path);
			}
		}
	}

	private handleSelect(path: string, resolution: ConflictResolution): void {
		this.selections.set(path, resolution);
		const controller = this.rowControllers.get(path);
		controller?.setResolution(resolution);
		this.updateApplyButtonState();
	}

	private handleToggle(item: ConflictItem): void {
		const path = item.path;
		const wasExpanded = this.expanded.get(path) ?? false;
		const nowExpanded = !wasExpanded;
		this.expanded.set(path, nowExpanded);
		this.measuredHeights.delete(path);
		const controller = this.rowControllers.get(path);
		controller?.setExpanded(nowExpanded);

		if (nowExpanded && !this.contentCache.has(path)) {
			void this.loadContent(item);
		}

		this.renderVisible();
	}

	private async loadContent(item: ConflictItem): Promise<void> {
		this.contentCache.set(item.path, { status: 'loading' });
		this.rowControllers.get(item.path)?.setContent({ status: 'loading' });
		this.renderVisible();

		try {
			if (item.isBinary) {
				const state: ConflictRowContentState = {
					status: 'binary',
					localSize: item.localSize,
					remoteSize: item.remoteSize,
				};
				this.contentCache.set(item.path, state);
				this.rowControllers.get(item.path)?.setContent(state);
				this.renderVisible();
				return;
			}

			const localText = item.local === 'deleted' ? '' : await this.readLocalText(item.path);
			const remoteText =
				item.remote === 'deleted' || !item.remoteBlobSha
					? ''
					: await this.readRemoteText(item.remoteBlobSha);
			const lines = computeLineDiff(localText, remoteText);
			const state: ConflictRowContentState = { status: 'text', lines };
			this.contentCache.set(item.path, state);
			this.rowControllers.get(item.path)?.setContent(state);
			this.renderVisible();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const state: ConflictRowContentState = { status: 'error', message };
			this.contentCache.set(item.path, state);
			this.rowControllers.get(item.path)?.setContent(state);
			this.renderVisible();
		}
	}

	private async readLocalText(path: string): Promise<string> {
		if (!(await this.vault.exists(path))) return '';
		return this.vault.readText(path);
	}

	private async readRemoteText(blobSha: string): Promise<string> {
		const { owner, repo } = this.getRepoCoords();
		const buf = await this.client.getBlob(owner, repo, blobSha);
		return new TextDecoder().decode(buf);
	}

	private updateApplyButtonState(): void {
		if (!this.applyBtn) return;
		this.applyBtn.disabled = this.selections.size < this.conflicts.length;
	}
}

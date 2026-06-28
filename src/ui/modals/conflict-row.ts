import type { DiffLine } from '../diff';
import type { ConflictItem, ConflictResolution } from '../../sync-engine-types';

export type ConflictRowContentState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'binary'; localSize: number; remoteSize: number }
	| { status: 'text'; lines: DiffLine[] };

export interface ConflictRowOptions {
	item: ConflictItem;
	initialResolution: ConflictResolution | null;
	initialExpanded: boolean;
	onSelect: (resolution: ConflictResolution) => void;
	onToggle: () => void;
	onHeightChange?: (height: number) => void;
}

export interface ConflictRowController {
	el: HTMLElement;
	setResolution(resolution: ConflictResolution | null): void;
	setExpanded(expanded: boolean): void;
	setContent(content: ConflictRowContentState): void;
	disconnect(): void;
}

export function createConflictRow(opts: ConflictRowOptions): ConflictRowController {
	const root = document.createElement('div');
	root.classList.add('cawsync-conflict-row');
	root.dataset.path = opts.item.path;

	const header = document.createElement('div');
	header.classList.add('cawsync-conflict-row-header');

	const caret = document.createElement('button');
	caret.type = 'button';
	caret.classList.add('cawsync-conflict-row-caret');
	caret.setAttribute('aria-label', 'Toggle diff view');
	caret.addEventListener('click', () => opts.onToggle());

	const pathEl = document.createElement('span');
	pathEl.classList.add('cawsync-conflict-row-path');
	pathEl.textContent = opts.item.path;

	const keepLocalBtn = document.createElement('button');
	keepLocalBtn.type = 'button';
	keepLocalBtn.classList.add('cawsync-conflict-row-button', 'cawsync-keep-local');
	keepLocalBtn.textContent = 'Keep local';
	keepLocalBtn.addEventListener('click', () => opts.onSelect('keep-local'));

	const keepRemoteBtn = document.createElement('button');
	keepRemoteBtn.type = 'button';
	keepRemoteBtn.classList.add('cawsync-conflict-row-button', 'cawsync-keep-remote');
	keepRemoteBtn.textContent = 'Keep remote';
	keepRemoteBtn.addEventListener('click', () => opts.onSelect('keep-remote'));

	header.append(caret, pathEl, keepLocalBtn, keepRemoteBtn);

	const body = document.createElement('div');
	body.classList.add('cawsync-conflict-row-body');

	root.append(header, body);

	function setResolution(resolution: ConflictResolution | null): void {
		keepLocalBtn.classList.toggle('cawsync-selected', resolution === 'keep-local');
		keepRemoteBtn.classList.toggle('cawsync-selected', resolution === 'keep-remote');
		root.classList.toggle('cawsync-resolved', resolution !== null);
	}

	function setExpanded(expanded: boolean): void {
		root.classList.toggle('cawsync-expanded', expanded);
		caret.setAttribute('aria-expanded', String(expanded));
	}

	function setContent(content: ConflictRowContentState): void {
		while (body.firstChild) body.removeChild(body.firstChild);

		if (content.status === 'loading') {
			const el = document.createElement('div');
			el.classList.add('cawsync-conflict-row-loading');
			el.textContent = 'Loading…';
			body.append(el);
			return;
		}

		if (content.status === 'error') {
			const el = document.createElement('div');
			el.classList.add('cawsync-conflict-row-error');
			el.textContent = content.message;
			body.append(el);
			return;
		}

		if (content.status === 'binary') {
			const el = document.createElement('div');
			el.classList.add('cawsync-conflict-row-binary');
			el.textContent = `(binary file, ${content.localSize} bytes locally, ${content.remoteSize} bytes remotely)`;
			body.append(el);
			return;
		}

		const list = document.createElement('div');
		list.classList.add('cawsync-diff');
		for (const line of content.lines) {
			const lineEl = document.createElement('div');
			lineEl.classList.add('cawsync-diff-line', `cawsync-diff-${line.kind}`);
			lineEl.dataset.kind = line.kind;
			lineEl.textContent = line.text;
			list.append(lineEl);
		}
		body.append(list);
	}

	setResolution(opts.initialResolution);
	setExpanded(opts.initialExpanded);

	let observer: ResizeObserver | null = null;
	const onHeightChange = opts.onHeightChange;
	if (onHeightChange) {
		observer = new ResizeObserver(() => onHeightChange(root.offsetHeight));
		observer.observe(root);
	}

	function disconnect(): void {
		observer?.disconnect();
		observer = null;
	}

	return { el: root, setResolution, setExpanded, setContent, disconnect };
}

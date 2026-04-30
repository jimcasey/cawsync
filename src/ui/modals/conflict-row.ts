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
}

export interface ConflictRowController {
	el: HTMLElement;
	setResolution(resolution: ConflictResolution | null): void;
	setExpanded(expanded: boolean): void;
	setContent(content: ConflictRowContentState): void;
}

export function createConflictRow(opts: ConflictRowOptions): ConflictRowController {
	const root = document.createElement('div');
	root.classList.add('jackdaw-conflict-row');
	root.dataset.path = opts.item.path;

	const header = document.createElement('div');
	header.classList.add('jackdaw-conflict-row-header');

	const caret = document.createElement('button');
	caret.type = 'button';
	caret.classList.add('jackdaw-conflict-row-caret');
	caret.setAttribute('aria-label', 'Toggle diff view');
	caret.addEventListener('click', () => opts.onToggle());

	const pathEl = document.createElement('span');
	pathEl.classList.add('jackdaw-conflict-row-path');
	pathEl.textContent = opts.item.path;

	const keepLocalBtn = document.createElement('button');
	keepLocalBtn.type = 'button';
	keepLocalBtn.classList.add('jackdaw-conflict-row-button', 'jackdaw-keep-local');
	keepLocalBtn.textContent = 'Keep local';
	keepLocalBtn.addEventListener('click', () => opts.onSelect('keep-local'));

	const keepRemoteBtn = document.createElement('button');
	keepRemoteBtn.type = 'button';
	keepRemoteBtn.classList.add('jackdaw-conflict-row-button', 'jackdaw-keep-remote');
	keepRemoteBtn.textContent = 'Keep remote';
	keepRemoteBtn.addEventListener('click', () => opts.onSelect('keep-remote'));

	header.append(caret, pathEl, keepLocalBtn, keepRemoteBtn);

	const body = document.createElement('div');
	body.classList.add('jackdaw-conflict-row-body');

	root.append(header, body);

	function setResolution(resolution: ConflictResolution | null): void {
		keepLocalBtn.classList.toggle('jackdaw-selected', resolution === 'keep-local');
		keepRemoteBtn.classList.toggle('jackdaw-selected', resolution === 'keep-remote');
		root.classList.toggle('jackdaw-resolved', resolution !== null);
	}

	function setExpanded(expanded: boolean): void {
		root.classList.toggle('jackdaw-expanded', expanded);
		caret.setAttribute('aria-expanded', String(expanded));
	}

	function setContent(content: ConflictRowContentState): void {
		while (body.firstChild) body.removeChild(body.firstChild);

		if (content.status === 'loading') {
			const el = document.createElement('div');
			el.classList.add('jackdaw-conflict-row-loading');
			el.textContent = 'Loading…';
			body.append(el);
			return;
		}

		if (content.status === 'error') {
			const el = document.createElement('div');
			el.classList.add('jackdaw-conflict-row-error');
			el.textContent = content.message;
			body.append(el);
			return;
		}

		if (content.status === 'binary') {
			const el = document.createElement('div');
			el.classList.add('jackdaw-conflict-row-binary');
			el.textContent = `(binary file, ${content.localSize} bytes locally, ${content.remoteSize} bytes remotely)`;
			body.append(el);
			return;
		}

		const list = document.createElement('div');
		list.classList.add('jackdaw-diff');
		for (const line of content.lines) {
			const lineEl = document.createElement('div');
			lineEl.classList.add('jackdaw-diff-line', `jackdaw-diff-${line.kind}`);
			lineEl.dataset.kind = line.kind;
			lineEl.textContent = line.text;
			list.append(lineEl);
		}
		body.append(list);
	}

	setResolution(opts.initialResolution);
	setExpanded(opts.initialExpanded);

	return { el: root, setResolution, setExpanded, setContent };
}

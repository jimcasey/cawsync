// @vitest-environment happy-dom
import { describe, test, expect, vi } from 'vitest';
import { createConflictRow } from '../src/ui/modals/conflict-row';
import type { ConflictItem } from '../src/sync-engine-types';

function makeItem(overrides: Partial<ConflictItem> = {}): ConflictItem {
	return {
		path: 'notes/foo.md',
		action: 'conflict',
		local: 'modified',
		remote: 'modified',
		isBinary: false,
		localSize: 100,
		remoteSize: 120,
		...overrides,
	};
}

describe('createConflictRow', () => {
	test('renders collapsed row with path and two buttons', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect: () => {},
			onToggle: () => {},
		});

		expect(row.el.classList.contains('jackdaw-conflict-row')).toBe(true);
		expect(row.el.classList.contains('jackdaw-expanded')).toBe(false);
		expect(row.el.dataset.path).toBe('notes/foo.md');
		expect(row.el.querySelector('.jackdaw-conflict-row-path')?.textContent).toBe('notes/foo.md');
		expect(row.el.querySelectorAll('.jackdaw-conflict-row-button').length).toBe(2);
	});

	test('clicking Keep local invokes onSelect with keep-local', () => {
		const onSelect = vi.fn();
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect,
			onToggle: () => {},
		});
		const btn = row.el.querySelector('.jackdaw-keep-local') as HTMLButtonElement;
		btn.click();
		expect(onSelect).toHaveBeenCalledWith('keep-local');
	});

	test('clicking Keep remote invokes onSelect with keep-remote', () => {
		const onSelect = vi.fn();
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect,
			onToggle: () => {},
		});
		const btn = row.el.querySelector('.jackdaw-keep-remote') as HTMLButtonElement;
		btn.click();
		expect(onSelect).toHaveBeenCalledWith('keep-remote');
	});

	test('caret click invokes onToggle', () => {
		const onToggle = vi.fn();
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect: () => {},
			onToggle,
		});
		const caret = row.el.querySelector('.jackdaw-conflict-row-caret') as HTMLButtonElement;
		caret.click();
		expect(onToggle).toHaveBeenCalled();
	});

	test('setResolution highlights the selected button and adds resolved class', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect: () => {},
			onToggle: () => {},
		});
		const localBtn = row.el.querySelector('.jackdaw-keep-local') as HTMLElement;
		const remoteBtn = row.el.querySelector('.jackdaw-keep-remote') as HTMLElement;

		row.setResolution('keep-local');
		expect(localBtn.classList.contains('jackdaw-selected')).toBe(true);
		expect(remoteBtn.classList.contains('jackdaw-selected')).toBe(false);
		expect(row.el.classList.contains('jackdaw-resolved')).toBe(true);

		row.setResolution('keep-remote');
		expect(localBtn.classList.contains('jackdaw-selected')).toBe(false);
		expect(remoteBtn.classList.contains('jackdaw-selected')).toBe(true);

		row.setResolution(null);
		expect(localBtn.classList.contains('jackdaw-selected')).toBe(false);
		expect(remoteBtn.classList.contains('jackdaw-selected')).toBe(false);
		expect(row.el.classList.contains('jackdaw-resolved')).toBe(false);
	});

	test('setExpanded toggles jackdaw-expanded class and aria-expanded', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect: () => {},
			onToggle: () => {},
		});
		const caret = row.el.querySelector('.jackdaw-conflict-row-caret') as HTMLElement;

		row.setExpanded(true);
		expect(row.el.classList.contains('jackdaw-expanded')).toBe(true);
		expect(caret.getAttribute('aria-expanded')).toBe('true');

		row.setExpanded(false);
		expect(row.el.classList.contains('jackdaw-expanded')).toBe(false);
		expect(caret.getAttribute('aria-expanded')).toBe('false');
	});

	test('initialExpanded=true starts in expanded state', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		expect(row.el.classList.contains('jackdaw-expanded')).toBe(true);
	});

	test('setContent renders loading state', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		row.setContent({ status: 'loading' });
		expect(row.el.querySelector('.jackdaw-conflict-row-loading')?.textContent).toBe('Loading…');
	});

	test('setContent renders error message', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		row.setContent({ status: 'error', message: 'Network error' });
		expect(row.el.querySelector('.jackdaw-conflict-row-error')?.textContent).toBe('Network error');
	});

	test('setContent renders binary byte-count summary', () => {
		const row = createConflictRow({
			item: makeItem({ isBinary: true, localSize: 1024, remoteSize: 2048 }),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		row.setContent({ status: 'binary', localSize: 1024, remoteSize: 2048 });
		const text = row.el.querySelector('.jackdaw-conflict-row-binary')?.textContent;
		expect(text).toBe('(binary file, 1024 bytes locally, 2048 bytes remotely)');
	});

	test('setContent renders text diff lines with kind classes', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		row.setContent({
			status: 'text',
			lines: [
				{ kind: 'context', text: 'unchanged', localLineNumber: 1, remoteLineNumber: 1 },
				{ kind: 'remove', text: 'old', localLineNumber: 2 },
				{ kind: 'add', text: 'new', remoteLineNumber: 2 },
			],
		});
		const lineEls = row.el.querySelectorAll('.jackdaw-diff-line');
		expect(lineEls.length).toBe(3);
		expect(lineEls[0].classList.contains('jackdaw-diff-context')).toBe(true);
		expect(lineEls[0].textContent).toBe('unchanged');
		expect((lineEls[0] as HTMLElement).dataset.kind).toBe('context');
		expect(lineEls[1].classList.contains('jackdaw-diff-remove')).toBe(true);
		expect(lineEls[1].textContent).toBe('old');
		expect(lineEls[2].classList.contains('jackdaw-diff-add')).toBe(true);
		expect(lineEls[2].textContent).toBe('new');
	});

	test('setContent replaces previous content rather than appending', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: true,
			onSelect: () => {},
			onToggle: () => {},
		});
		row.setContent({ status: 'loading' });
		row.setContent({ status: 'binary', localSize: 10, remoteSize: 20 });
		expect(row.el.querySelectorAll('.jackdaw-conflict-row-loading').length).toBe(0);
		expect(row.el.querySelectorAll('.jackdaw-conflict-row-binary').length).toBe(1);
	});
});

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

		expect(row.el.classList.contains('cawsync-conflict-row')).toBe(true);
		expect(row.el.classList.contains('cawsync-expanded')).toBe(false);
		expect(row.el.dataset.path).toBe('notes/foo.md');
		expect(row.el.querySelector('.cawsync-conflict-row-path')?.textContent).toBe('notes/foo.md');
		expect(row.el.querySelectorAll('.cawsync-conflict-row-button').length).toBe(2);
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
		const btn = row.el.querySelector('.cawsync-keep-local') as HTMLButtonElement;
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
		const btn = row.el.querySelector('.cawsync-keep-remote') as HTMLButtonElement;
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
		const caret = row.el.querySelector('.cawsync-conflict-row-caret') as HTMLButtonElement;
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
		const localBtn = row.el.querySelector('.cawsync-keep-local') as HTMLElement;
		const remoteBtn = row.el.querySelector('.cawsync-keep-remote') as HTMLElement;

		row.setResolution('keep-local');
		expect(localBtn.classList.contains('cawsync-selected')).toBe(true);
		expect(remoteBtn.classList.contains('cawsync-selected')).toBe(false);
		expect(row.el.classList.contains('cawsync-resolved')).toBe(true);

		row.setResolution('keep-remote');
		expect(localBtn.classList.contains('cawsync-selected')).toBe(false);
		expect(remoteBtn.classList.contains('cawsync-selected')).toBe(true);

		row.setResolution(null);
		expect(localBtn.classList.contains('cawsync-selected')).toBe(false);
		expect(remoteBtn.classList.contains('cawsync-selected')).toBe(false);
		expect(row.el.classList.contains('cawsync-resolved')).toBe(false);
	});

	test('setExpanded toggles cawsync-expanded class and aria-expanded', () => {
		const row = createConflictRow({
			item: makeItem(),
			initialResolution: null,
			initialExpanded: false,
			onSelect: () => {},
			onToggle: () => {},
		});
		const caret = row.el.querySelector('.cawsync-conflict-row-caret') as HTMLElement;

		row.setExpanded(true);
		expect(row.el.classList.contains('cawsync-expanded')).toBe(true);
		expect(caret.getAttribute('aria-expanded')).toBe('true');

		row.setExpanded(false);
		expect(row.el.classList.contains('cawsync-expanded')).toBe(false);
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
		expect(row.el.classList.contains('cawsync-expanded')).toBe(true);
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
		expect(row.el.querySelector('.cawsync-conflict-row-loading')?.textContent).toBe('Loading…');
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
		expect(row.el.querySelector('.cawsync-conflict-row-error')?.textContent).toBe('Network error');
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
		const text = row.el.querySelector('.cawsync-conflict-row-binary')?.textContent;
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
		const lineEls = row.el.querySelectorAll('.cawsync-diff-line');
		expect(lineEls.length).toBe(3);
		expect(lineEls[0].classList.contains('cawsync-diff-context')).toBe(true);
		expect(lineEls[0].textContent).toBe('unchanged');
		expect((lineEls[0] as HTMLElement).dataset.kind).toBe('context');
		expect(lineEls[1].classList.contains('cawsync-diff-remove')).toBe(true);
		expect(lineEls[1].textContent).toBe('old');
		expect(lineEls[2].classList.contains('cawsync-diff-add')).toBe(true);
		expect(lineEls[2].textContent).toBe('new');
	});

	test('no ResizeObserver is created when onHeightChange is omitted; disconnect is still safe', () => {
		const instances: FakeObserver[] = [];
		class FakeObserver {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor(public cb: ResizeObserverCallback) {
				instances.push(this);
			}
		}
		const original = globalThis.ResizeObserver;
		globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
		try {
			const row = createConflictRow({
				item: makeItem(),
				initialResolution: null,
				initialExpanded: false,
				onSelect: () => {},
				onToggle: () => {},
			});
			expect(instances.length).toBe(0);
			expect(() => row.disconnect()).not.toThrow();
			expect(() => row.disconnect()).not.toThrow();
		} finally {
			globalThis.ResizeObserver = original;
		}
	});

	test('ResizeObserver is created and observed when onHeightChange is provided; disconnect() invokes the observer', () => {
		const instances: FakeObserver[] = [];
		class FakeObserver {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor(public cb: ResizeObserverCallback) {
				instances.push(this);
			}
		}
		const original = globalThis.ResizeObserver;
		globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
		try {
			const row = createConflictRow({
				item: makeItem({ path: 'notes/bar.md' }),
				initialResolution: null,
				initialExpanded: false,
				onSelect: () => {},
				onToggle: () => {},
				onHeightChange: vi.fn(),
			});
			expect(instances.length).toBe(1);
			expect(instances[0].observe).toHaveBeenCalledWith(row.el);
			expect(instances[0].disconnect).not.toHaveBeenCalled();
			row.disconnect();
			expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
			row.disconnect();
			expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.ResizeObserver = original;
		}
	});

	test('onHeightChange receives the row offsetHeight when ResizeObserver fires', () => {
		const onHeightChange = vi.fn();
		const instances: FakeObserver[] = [];
		class FakeObserver {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor(public cb: () => void) {
				instances.push(this);
			}
		}
		const original = globalThis.ResizeObserver;
		globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
		try {
			const row = createConflictRow({
				item: makeItem(),
				initialResolution: null,
				initialExpanded: false,
				onSelect: () => {},
				onToggle: () => {},
				onHeightChange,
			});
			Object.defineProperty(row.el, 'offsetHeight', { configurable: true, get: () => 137 });
			instances[0].cb();
			expect(onHeightChange).toHaveBeenCalledWith(137);
		} finally {
			globalThis.ResizeObserver = original;
		}
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
		expect(row.el.querySelectorAll('.cawsync-conflict-row-loading').length).toBe(0);
		expect(row.el.querySelectorAll('.cawsync-conflict-row-binary').length).toBe(1);
	});
});

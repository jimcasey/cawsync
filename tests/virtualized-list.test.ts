import { describe, test, expect } from 'vitest';
import { computeVirtualWindow } from '../src/ui/modals/virtualized-list';

describe('computeVirtualWindow', () => {
	test('empty itemCount returns empty window', () => {
		const win = computeVirtualWindow({
			scrollTop: 0,
			viewportHeight: 100,
			itemCount: 0,
			getItemHeight: () => 50,
		});
		expect(win).toEqual({ startIndex: 0, endIndex: 0, totalHeight: 0, offsetY: 0 });
	});

	test('totalHeight sums all item heights', () => {
		const win = computeVirtualWindow({
			scrollTop: 0,
			viewportHeight: 100,
			itemCount: 5,
			getItemHeight: () => 40,
			overscan: 0,
		});
		expect(win.totalHeight).toBe(200);
	});

	test('scrollTop=0 with viewport=100, items 50px each → first 2 visible (no overscan)', () => {
		const win = computeVirtualWindow({
			scrollTop: 0,
			viewportHeight: 100,
			itemCount: 10,
			getItemHeight: () => 50,
			overscan: 0,
		});
		expect(win.startIndex).toBe(0);
		expect(win.endIndex).toBe(2);
		expect(win.offsetY).toBe(0);
	});

	test('overscan extends start and end by N items', () => {
		const win = computeVirtualWindow({
			scrollTop: 200,
			viewportHeight: 100,
			itemCount: 20,
			getItemHeight: () => 50,
			overscan: 2,
		});
		// scrollTop=200 → first visible is item 4 (200..250), last visible item 5 (250..300)
		// With overscan=2: start=2, end=8
		expect(win.startIndex).toBe(2);
		expect(win.endIndex).toBe(8);
		expect(win.offsetY).toBe(100);
	});

	test('overscan does not push start below 0 or end above itemCount', () => {
		const winTop = computeVirtualWindow({
			scrollTop: 0,
			viewportHeight: 100,
			itemCount: 10,
			getItemHeight: () => 50,
			overscan: 5,
		});
		expect(winTop.startIndex).toBe(0);
		expect(winTop.offsetY).toBe(0);

		const winBottom = computeVirtualWindow({
			scrollTop: 450,
			viewportHeight: 100,
			itemCount: 10,
			getItemHeight: () => 50,
			overscan: 5,
		});
		expect(winBottom.endIndex).toBe(10);
	});

	test('variable item heights yield correct offsetY', () => {
		const heights = [40, 60, 80, 100, 120];
		const win = computeVirtualWindow({
			scrollTop: 150,
			viewportHeight: 100,
			itemCount: heights.length,
			getItemHeight: (i) => heights[i],
			overscan: 0,
		});
		// Cumulative tops: [0, 40, 100, 180, 280, 400]
		// scrollTop=150 → first item whose bottom > 150 is index 2 (spans 100..180), offsetY=100
		// bottom=250 → endIndex set when cumulative top >= 250, which happens at index 4 (top=280)
		expect(win.startIndex).toBe(2);
		expect(win.offsetY).toBe(100);
		expect(win.endIndex).toBe(4);
		expect(win.totalHeight).toBe(400);
	});

	test('scrollTop beyond content returns empty window past the end', () => {
		const win = computeVirtualWindow({
			scrollTop: 1000,
			viewportHeight: 100,
			itemCount: 5,
			getItemHeight: () => 50,
		});
		expect(win.startIndex).toBe(5);
		expect(win.endIndex).toBe(5);
		expect(win.totalHeight).toBe(250);
		expect(win.offsetY).toBe(250);
	});

	test('default overscan of 3 is applied', () => {
		const win = computeVirtualWindow({
			scrollTop: 250,
			viewportHeight: 100,
			itemCount: 20,
			getItemHeight: () => 50,
		});
		// Without overscan: start=5, end=7. With default overscan=3: start=2, end=10.
		expect(win.startIndex).toBe(2);
		expect(win.endIndex).toBe(10);
	});

	test('negative scrollTop is clamped to 0', () => {
		const win = computeVirtualWindow({
			scrollTop: -100,
			viewportHeight: 100,
			itemCount: 10,
			getItemHeight: () => 50,
			overscan: 0,
		});
		expect(win.startIndex).toBe(0);
		expect(win.offsetY).toBe(0);
	});
});

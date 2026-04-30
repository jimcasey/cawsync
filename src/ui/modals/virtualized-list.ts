export interface VirtualWindow {
	startIndex: number;
	endIndex: number;
	totalHeight: number;
	offsetY: number;
}

export interface VirtualWindowParams {
	scrollTop: number;
	viewportHeight: number;
	itemCount: number;
	getItemHeight: (index: number) => number;
	overscan?: number;
}

export function computeVirtualWindow(params: VirtualWindowParams): VirtualWindow {
	const overscan = params.overscan ?? 3;
	const { scrollTop, viewportHeight, itemCount, getItemHeight } = params;

	if (itemCount === 0) {
		return { startIndex: 0, endIndex: 0, totalHeight: 0, offsetY: 0 };
	}

	const top = Math.max(0, scrollTop);
	const bottom = top + Math.max(0, viewportHeight);

	let cumulative = 0;
	let startIndex = -1;
	let endIndex = itemCount;
	let offsetY = 0;

	for (let i = 0; i < itemCount; i++) {
		const h = getItemHeight(i);
		if (startIndex === -1 && cumulative + h > top) {
			startIndex = i;
			offsetY = cumulative;
		}
		if (endIndex === itemCount && cumulative >= bottom) {
			endIndex = i;
		}
		cumulative += h;
	}

	if (startIndex === -1) {
		return {
			startIndex: itemCount,
			endIndex: itemCount,
			totalHeight: cumulative,
			offsetY: cumulative,
		};
	}

	for (let k = 0; k < overscan && startIndex > 0; k++) {
		startIndex--;
		offsetY -= getItemHeight(startIndex);
	}
	endIndex = Math.min(itemCount, endIndex + overscan);

	return { startIndex, endIndex, totalHeight: cumulative, offsetY };
}

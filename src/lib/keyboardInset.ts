/**
 * Pure helpers for the mobile keyboard inset (platform lessons
 * section 3): the difference between layout and visual viewports,
 * applied as padding, never as height. Unit-tested because the
 * double-subtraction regression is the one that cost a night.
 */

export function keyboardInset(options: {
	layoutHeight: number;
	visualHeight: number | undefined;
	offsetTop: number;
	scale?: number;
}): number {
	const { layoutHeight, visualHeight, offsetTop, scale } = options;
	if (visualHeight === undefined) return 0;
	if (scale !== undefined && scale > 1.01) return 0; // pinch zoom
	const covered = layoutHeight - (visualHeight + offsetTop);
	return covered > 1 ? Math.round(covered) : 0;
}

/**
 * Paper and Ink design tokens (docs/02-design-system.md).
 * Colors ship as CSS variables so a theme switch is one attribute
 * change; components never hardcode colors. This file holds the
 * non-color contract: type scale, spacing, shape, motion.
 */

export const font = {
	ui: "'Manrope Variable', 'Manrope', system-ui, sans-serif",
	display: "'Fraunces Variable', 'Fraunces', Georgia, serif",
} as const;

export const type = {
	display: {
		fontFamily: font.display,
		fontSize: "2rem",
		lineHeight: 1.19,
		fontWeight: 600,
		letterSpacing: "-0.01em",
	},
	titleL: { fontFamily: font.ui, fontSize: "1.5rem", lineHeight: 1.25, fontWeight: 700 },
	titleM: { fontFamily: font.ui, fontSize: "1.1875rem", lineHeight: 1.32, fontWeight: 700 },
	titleS: { fontFamily: font.ui, fontSize: "1rem", lineHeight: 1.375, fontWeight: 600 },
	body: { fontFamily: font.ui, fontSize: "0.9375rem", lineHeight: 1.47, fontWeight: 400 },
	bodyStrong: { fontFamily: font.ui, fontSize: "0.9375rem", lineHeight: 1.47, fontWeight: 600 },
	small: { fontFamily: font.ui, fontSize: "0.8125rem", lineHeight: 1.38, fontWeight: 400 },
	caption: { fontFamily: font.ui, fontSize: "0.6875rem", lineHeight: 1.27, fontWeight: 500 },
} as const;

export const space = {
	1: "4px",
	2: "8px",
	3: "12px",
	4: "16px",
	5: "20px",
	6: "24px",
	8: "32px",
	10: "40px",
	12: "48px",
} as const;

export const radius = {
	s: "8px",
	m: "12px",
	l: "16px",
	xl: "20px",
	full: "999px",
} as const;

export const motion = {
	dur: {
		instant: "100ms",
		fast: "180ms",
		standard: "240ms",
		expressive: "340ms",
		settle: "480ms",
	},
	ease: {
		standard: "cubic-bezier(0.2, 0, 0, 1)",
		enter: "cubic-bezier(0.05, 0.7, 0.1, 1)",
		exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
	},
} as const;

export const layout = {
	minTouch: "48px",
	toolbarHeight: "56px",
	buttonHeight: "44px",
	listRowHeight: "64px",
	contentMaxWidth: "640px",
} as const;

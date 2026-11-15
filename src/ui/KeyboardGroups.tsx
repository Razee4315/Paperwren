import { useEffect } from "react";

const groups = '[role="toolbar"], [role="radiogroup"], [data-roving-tabs]';
const controls =
	'button:not(:disabled), [role="radio"], [role="tab"], input:not(:disabled):not([type="hidden"]), select:not(:disabled), [href]';

/** Shared APG keyboard behavior for the app's button groups. */
export function KeyboardGroups() {
	useEffect(() => {
		const owner = (item: Element): Element | null => {
			const group = item.closest(groups);
			return group?.parentElement?.closest('[role="toolbar"]') ?? group;
		};
		const items = (group: Element) =>
			Array.from(group.querySelectorAll<HTMLElement>(controls)).filter(
				(item) =>
					owner(item) === group &&
					item.getAttribute("aria-disabled") !== "true" &&
					item.getClientRects().length > 0,
			);
		const sync = (group: Element) => {
			const container =
				group.parentElement?.closest('[role="toolbar"]') ?? group;
			const list = items(container);
			const chosen =
				list.find((item) => item === document.activeElement) ??
				list.find((item) =>
					item.matches('[aria-checked="true"], [aria-selected="true"]'),
				) ??
				list.find((item) => item.tabIndex === 0) ??
				list[0];
			for (const item of list) item.tabIndex = item === chosen ? 0 : -1;
		};
		const refresh = (node: Node) => {
			if (!(node instanceof Element)) return;
			const parent = node.closest(groups);
			if (parent) sync(parent);
			for (const group of node.querySelectorAll(groups)) sync(group);
		};
		refresh(document.body);
		// Only selection and disabled changes are watched. Watching added
		// nodes would run on every page and text layer the viewers draw;
		// a group that mounts later is set up when focus first enters it.
		const observer = new MutationObserver((records) => {
			for (const record of records) refresh(record.target);
		});
		observer.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ["aria-checked", "aria-selected", "disabled"],
		});
		const focus = (event: FocusEvent) => {
			const group = owner(event.target as Element);
			if (group) sync(group);
		};
		const key = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey
			)
				return;
			const target = event.target as HTMLElement;
			if (!target.matches(controls)) return;
			if (target.matches("input, select, textarea") || target.isContentEditable)
				return;
			const group = owner(target);
			if (!group) return;
			const list = items(group);
			const at = list.indexOf(target);
			if (at < 0) return;
			const radio = group.getAttribute("role") === "radiogroup";
			const vertical = group.getAttribute("aria-orientation") === "vertical";
			const rtl = getComputedStyle(group).direction === "rtl";
			let delta = 0;
			if (radio || !vertical) {
				if (event.key === "ArrowRight") delta = rtl ? -1 : 1;
				if (event.key === "ArrowLeft") delta = rtl ? 1 : -1;
			}
			if (radio || vertical) {
				if (event.key === "ArrowDown") delta = 1;
				if (event.key === "ArrowUp") delta = -1;
			}
			const next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? list.length - 1
						: delta
							? (at + delta + list.length) % list.length
							: -1;
			if (next < 0) return;
			event.preventDefault();
			list[next].focus();
			if (
				(radio && !group.parentElement?.closest('[role="toolbar"]')) ||
				group.hasAttribute("data-roving-tabs")
			)
				list[next].click();
		};
		document.addEventListener("focusin", focus);
		document.addEventListener("keydown", key);
		return () => {
			observer.disconnect();
			document.removeEventListener("focusin", focus);
			document.removeEventListener("keydown", key);
		};
	}, []);
	return null;
}

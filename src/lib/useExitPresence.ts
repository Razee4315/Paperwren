import { type RefObject, useLayoutEffect } from "react";

/** Keep only an inert visual at unmount, releasing focus and input at once.
 * Also covers callers that conditionally mount their overlay. */
export function useExitPresence(
	ref: RefObject<HTMLElement | null>,
	identity?: unknown,
	enabled = true,
) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: a replacement toast retires the previous visual
	useLayoutEffect(() => {
		const element = ref.current;
		const duration = element
			? Number.parseFloat(
					getComputedStyle(element).getPropertyValue("--t-fast"),
				) || 120
			: 120;
		return () => {
			if (
				!enabled ||
				!element ||
				// Canvas pixels are not retained by cloneNode.
				element.querySelector("canvas") ||
				document.hidden ||
				window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
			)
				return;
			const visual = element.cloneNode(true) as HTMLElement;
			visual.setAttribute("inert", "");
			visual.setAttribute("aria-hidden", "true");
			visual.dataset.exiting = "";
			visual.removeAttribute("id");
			visual
				.querySelectorAll<HTMLElement>(
					"button, input, select, textarea, a, [tabindex]",
				)
				.forEach((node) => {
					node.setAttribute("tabindex", "-1");
				});
			visual
				.querySelectorAll("[id]")
				.forEach((node) => node.removeAttribute("id"));
			visual.style.pointerEvents = "none";
			document.body.append(visual);
			const finish = () => {
				window.clearTimeout(timer);
				visual.remove();
			};
			const timer = window.setTimeout(finish, duration + 80);
			visual.addEventListener("animationend", (event) => {
				if (event.target === visual) finish();
			});
		};
	}, [ref, identity, enabled]);
}

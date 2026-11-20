/** Scripted travel follows the system motion preference. */
export function scrollBehavior(): ScrollBehavior {
	return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		? "auto"
		: "smooth";
}

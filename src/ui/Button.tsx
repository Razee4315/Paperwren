import { isDesktop } from "@/lib/env";
import { keys } from "@/lib/keys";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
	variant = "primary",
	block = false,
	className,
	children,
	type = "button",
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: Variant;
	block?: boolean;
	children: ReactNode;
}) {
	const cls = [s.button, s[variant], block && s.block, className]
		.filter(Boolean)
		.join(" ");
	return (
		<button type={type} className={cls} {...rest}>
			{children}
		</button>
	);
}

export function IconButton({
	label,
	shortcut,
	active,
	className,
	children,
	type = "button",
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	/** The keys that do the same, named in the tooltip on a desktop. */
	shortcut?: string;
	/** A button that is on or off (Find, Laser): said aloud, and drawn
	 * pressed while on. Left out, it is a plain button. */
	active?: boolean;
	children: ReactNode;
}) {
	const cls = [s.icon, active && s.iconActive, className]
		.filter(Boolean)
		.join(" ");
	return (
		<button
			type={type}
			className={cls}
			aria-label={label}
			aria-pressed={active}
			title={shortcut && isDesktop ? `${label} (${keys(shortcut)})` : label}
			{...rest}
		>
			{children}
		</button>
	);
}

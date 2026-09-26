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
	active = false,
	className,
	children,
	type = "button",
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
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
			title={label}
			{...rest}
		>
			{children}
		</button>
	);
}

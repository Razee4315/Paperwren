import { isDesktop } from "@/lib/env";
import { msg, t } from "@/lib/i18n";
import { Button, Dialog, IconButton } from "@/ui";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import s from "./Shell.module.css";

interface PageJumpProps {
	page: number;
	pages: number;
	onGo: (page: number) => void;
	/** The page's own label where the document numbers its pages
	 * itself ("iv"); shown in place of the count. */
	label?: string | null;
	/** Go to what was typed, when a label may have been (else `onGo`). */
	onGoText?: (text: string) => void;
	/** What is being counted, for the words around the number. */
	what?: "page" | "slide";
	testId: string;
	/** A test id for the counter itself, where one is already in use. */
	counterTestId?: string;
}

const WORDS = {
	page: {
		go: msg("Go to page"),
		field: msg("Page number, 1 to {pages}"),
		at: msg("Page {page} of {pages}. Go to page"),
	},
	slide: {
		go: msg("Go to slide"),
		field: msg("Slide number, 1 to {pages}"),
		at: msg("Slide {page} of {pages}. Go to slide"),
	},
} as const;

/** The desktop form: the page number is a field in the bar. Type a
 * number, press Enter. */
function PageField({
	page,
	pages,
	onGo,
	label,
	onGoText,
	what = "page",
	testId,
	counterTestId,
}: PageJumpProps) {
	const words = WORDS[what];
	const shown = label || String(page);
	// What is being typed; null while the field just shows the page.
	const [draft, setDraft] = useState<string | null>(null);
	const submit = () => {
		const text = (draft ?? "").trim();
		setDraft(null);
		if (!text) return;
		if (onGoText) onGoText(text);
		else {
			const n = Math.round(Number(text));
			if (n >= 1 && n <= pages) onGo(n);
		}
	};
	return (
		<form
			className={s.pageField}
			// "3 / 12" reads the same way in every language.
			dir="ltr"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
				(document.activeElement as HTMLElement | null)?.blur();
			}}
		>
			<input
				dir="ltr"
				inputMode="numeric"
				autoComplete="off"
				spellCheck={false}
				value={draft ?? shown}
				style={{
					width: `${Math.max(String(pages).length, shown.length) + 2.5}ch`,
				}}
				onFocus={(e) => {
					setDraft(shown);
					const field = e.currentTarget;
					requestAnimationFrame(() => field.select());
				}}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => setDraft(null)}
				onKeyDown={(e) => {
					if (e.key === "Escape") e.currentTarget.blur();
				}}
				aria-label={t(words.field, { pages })}
				title={t(words.go)}
				data-testid={`${testId}-page-field`}
			/>
			<span data-testid={counterTestId ?? `${testId}-page`}>
				{label && label !== String(page)
					? `(${page} / ${pages})`
					: `/ ${pages}`}
			</span>
		</form>
	);
}

/** "3 / 12" in the bottom bar; tap it to go to a page by number. */
export function PageJump(props: PageJumpProps) {
	const { page, pages, onGo, label, what = "page", testId } = props;
	const { counterTestId } = props;
	const words = WORDS[what];
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	if (isDesktop) return <PageField {...props} />;
	const go = () => {
		const n = Math.round(Number(value));
		if (n >= 1 && n <= pages) onGo(n);
		setOpen(false);
	};
	return (
		<>
			<button
				type="button"
				className={s.pill}
				onClick={() => {
					setValue(String(page));
					setOpen(true);
				}}
				aria-label={t(words.at, { page, pages })}
				title={t(words.go)}
				data-testid={counterTestId ?? `${testId}-page`}
			>
				{label && label !== String(page) ? `${label} · ` : ""}
				{page} / {pages}
			</button>
			<Dialog
				open={open}
				title={t(words.go)}
				onClose={() => setOpen(false)}
				actions={
					<>
						<Button variant="ghost" onClick={() => setOpen(false)}>
							{t("Cancel")}
						</Button>
						<Button onClick={go} data-testid={`${testId}-jump-go`}>
							{t("Go")}
						</Button>
					</>
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						go();
					}}
				>
					<input
						className={s.input}
						type="number"
						inputMode="numeric"
						min={1}
						max={pages}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onFocus={(e) => e.currentTarget.select()}
						aria-label={t(words.field, { pages })}
						data-testid={`${testId}-jump-input`}
					/>
				</form>
			</Dialog>
		</>
	);
}

/** Asks for the password of a protected file (PDF, Office). */
export function PasswordDialog({
	open,
	name,
	wrong,
	onSubmit,
	onCancel,
	testId,
}: {
	open: boolean;
	name: string;
	/** The last password tried did not open the file. */
	wrong: boolean;
	onSubmit: (password: string) => void;
	onCancel: () => void;
	testId: string;
}) {
	const [password, setPassword] = useState("");
	// A long password typed blind on a phone is easy to get wrong.
	const [shown, setShown] = useState(false);
	return (
		<Dialog
			open={open}
			title={t("Password protected")}
			onClose={onCancel}
			actions={
				<>
					<Button variant="ghost" onClick={onCancel}>
						{t("Cancel")}
					</Button>
					<Button
						onClick={() => onSubmit(password)}
						disabled={!password}
						data-testid={`${testId}-unlock`}
					>
						{t("Open")}
					</Button>
				</>
			}
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (password) onSubmit(password);
				}}
			>
				<p className={s.passwordHint}>
					{wrong
						? t("That password didn't work. Try again.")
						: t("Enter the password for “{name}”.", { name })}
				</p>
				<div className={s.passwordField}>
					<input
						className={s.input}
						type={shown ? "text" : "password"}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						aria-label={t("Password")}
						data-testid={`${testId}-password`}
					/>
					<IconButton
						label={shown ? t("Hide password") : t("Show password")}
						aria-pressed={shown}
						onClick={() => setShown((v) => !v)}
						data-testid={`${testId}-password-show`}
					>
						{shown ? <EyeOff size={20} /> : <Eye size={20} />}
					</IconButton>
				</div>
			</form>
		</Dialog>
	);
}

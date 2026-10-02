import { t } from "@/lib/i18n";
import { Button, Dialog } from "@/ui";
import { useState } from "react";
import s from "./Shell.module.css";

/** "3 / 12" in the bottom bar; tap it to go to a page by number. */
export function PageJump({
	page,
	pages,
	onGo,
	testId,
}: {
	page: number;
	pages: number;
	onGo: (page: number) => void;
	testId: string;
}) {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
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
				aria-label={t("Page {page} of {pages}. Go to page", { page, pages })}
				title={t("Go to page")}
				data-testid={`${testId}-page`}
			>
				{page} / {pages}
			</button>
			<Dialog
				open={open}
				title={t("Go to page")}
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
						aria-label={t("Page number, 1 to {pages}", { pages })}
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
				<input
					className={s.input}
					type="password"
					autoComplete="off"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					aria-label={t("Password")}
					data-testid={`${testId}-password`}
				/>
			</form>
		</Dialog>
	);
}

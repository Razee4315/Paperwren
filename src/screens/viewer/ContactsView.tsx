import { t, uiDir } from "@/lib/i18n";
import { type ContactValue, parseVCard } from "@/lib/vcard";
import { IconButton, toast } from "@/ui";
import { Copy, Search } from "lucide-react";
import { useMemo, useRef } from "react";
import s from "./Contacts.module.css";
import { FindBar, Shell } from "./Shell";
import shellStyles from "./Shell.module.css";
import { useScrollMemory } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

function label(kind: ContactValue["kind"]) {
	switch (kind) {
		case "TEL":
			return t("Phone");
		case "EMAIL":
			return t("Email");
		case "ADR":
			return t("Address");
		case "ORG":
			return t("Organisation");
		case "TITLE":
			return t("Job title");
		case "URL":
			return t("Website");
		case "BDAY":
			return t("Birthday");
		case "NOTE":
			return t("Note");
	}
}
function typeLabels(types: string[]): string {
	return [
		...new Set(
			types
				.map((type) => {
					const normalized = type.trim().toLowerCase();
					switch (normalized) {
						case "cell":
						case "mobile":
							return t("Mobile");
						case "home":
							return t("Home");
						case "work":
							return t("Work");
						case "fax":
							return t("Fax");
						case "main":
							return t("Main");
						case "other":
							return t("Other");
					}
					if (
						/^(?:pref|voice|internet|quoted-printable|base64|b|utf-?8|iso-8859-\d+|us-ascii)$/i.test(
							normalized,
						) ||
						/^(?:x-|charset|encoding)/i.test(normalized)
					)
						return "";
					return type;
				})
				.filter(Boolean),
		),
	].join(", ");
}
function copy(value: string) {
	if (!navigator.clipboard) {
		toast(t("Couldn't copy"));
		return;
	}
	navigator.clipboard
		.writeText(value)
		.then(() => toast(t("Copied")))
		.catch(() => toast(t("Couldn't copy")));
}
export default function ContactsView({
	data,
	name,
	format,
	onClose,
	active,
	position,
	onPosition,
}: ViewerProps) {
	const contacts = useMemo(() => parseVCard(data), [data]);
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const find = useDomFind(content, scroller);
	useScrollMemory(scroller, true, position, onPosition, 1);
	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			progressOf={scroller}
			onFind={find.start}
			bottom={
				<>
					<span className={s.count}>
						{t("Contacts: {n}", { n: contacts.length })}
					</span>
					<IconButton
						label={t("Find in document")}
						onClick={() => find.start()}
					>
						<Search size={20} />
					</IconButton>
				</>
			}
			find={
				find.open ? (
					<FindBar
						state={find.state}
						onQuery={find.setQuery}
						onStep={find.step}
						onClose={find.close}
						options={find.options}
						onOptions={find.setOptions}
					/>
				) : undefined
			}
		>
			<div
				ref={scroller}
				className={s.scroll}
				dir={uiDir()}
				data-testid="contacts-scroll"
			>
				<div
					ref={content}
					className={s.list}
					data-finding={find.open || undefined}
				>
					{!contacts.length && (
						<p className={shellStyles.sideEmpty}>{t("No contacts found")}</p>
					)}
					{contacts.map((contact, index) => (
						<article key={index} className={s.card} data-testid="contact-card">
							<div className={s.heading}>
								{contact.photo && (
									<img
										className={s.photo}
										src={contact.photo}
										alt=""
										loading="lazy"
										data-testid="contact-photo"
									/>
								)}
								<h2 dir="auto">
									<button
										type="button"
										className={s.name}
										onClick={() => copy(contact.name)}
										title={t("Copy")}
									>
										{contact.name || t("Unnamed contact")}
									</button>
								</h2>
							</div>
							{contact.values.map((field, i) => (
								<button
									type="button"
									key={i}
									className={s.field}
									onClick={() => copy(field.value)}
									title={t("Copy")}
								>
									<span className={s.label}>
										<span>{label(field.kind)}</span>
										{typeLabels(field.types) && (
											<bdi>· {typeLabels(field.types)}</bdi>
										)}
									</span>
									<span
										className={s.value}
										dir={
											field.kind === "TEL" ||
											field.kind === "EMAIL" ||
											field.kind === "URL"
												? "ltr"
												: "auto"
										}
									>
										{field.value}
									</span>
									<Copy size={15} className={s.copy} aria-hidden="true" />
								</button>
							))}
						</article>
					))}
				</div>
			</div>
		</Shell>
	);
}

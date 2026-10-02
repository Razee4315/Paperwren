import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Dialog, toast } from "./Overlay";
import s from "./Overlay.module.css";

/** Addresses worth offering to copy; anything else (a relative path
 * to a file that is not here, a script) is simply not followed. */
const EXTERNAL = /^(https?:|mailto:|tel:)/i;

/** Scroll to the heading or bookmark a "#name" link points at. */
function scrollToAnchor(hash: string) {
	let id = hash.slice(1);
	try {
		id = decodeURIComponent(id);
	} catch {
		// Keep the raw name.
	}
	if (!id) return;
	const target =
		document.getElementById(id) ??
		document.querySelector(`a[name="${CSS.escape(id)}"]`);
	target?.scrollIntoView({ block: "start" });
}

/**
 * Documents carry links, and the page a document is drawn in is the
 * app itself: following one would replace Paperwren with a web page
 * (or an error page: the app has no network access). So no link is
 * ever followed. A link within the document scrolls to its target, and
 * a web or mail address is shown, to be copied and opened elsewhere.
 */
export function LinkGuard() {
	const [link, setLink] = useState<string | null>(null);

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			const anchor = (e.target as Element | null)?.closest?.("a[href]");
			if (!anchor) return;
			e.preventDefault();
			const href = anchor.getAttribute("href")?.trim() ?? "";
			if (href.startsWith("#")) scrollToAnchor(href);
			else if (EXTERNAL.test(href)) setLink(href);
		};
		// Capture: before a viewer's own handlers; "auxclick" is the
		// middle button, which would open a window.
		document.addEventListener("click", onClick, true);
		document.addEventListener("auxclick", onClick, true);
		return () => {
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("auxclick", onClick, true);
		};
	}, []);

	const close = () => setLink(null);
	const copy = () => {
		const address = link?.replace(/^(mailto|tel):/i, "") ?? "";
		close();
		if (!navigator.clipboard) {
			toast(t("Couldn't copy"));
			return;
		}
		navigator.clipboard
			.writeText(address)
			.then(() => toast(t("Link copied")))
			.catch(() => toast(t("Couldn't copy")));
	};

	return (
		<Dialog
			open={link !== null}
			title={t("Link in this document")}
			onClose={close}
			testId="link-guard"
			actions={
				<>
					<Button variant="ghost" onClick={close}>
						{t("Cancel")}
					</Button>
					<Button onClick={copy} data-testid="link-copy">
						{t("Copy link")}
					</Button>
				</>
			}
		>
			{t(
				"Paperwren doesn't open web pages. Copy the address to open it in your browser.",
			)}
			<span className={s.dialogNote} dir="ltr" data-testid="link-address">
				{link}
			</span>
		</Dialog>
	);
}

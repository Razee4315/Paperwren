import { splitName } from "@/lib/fileName";
import { formatFromName } from "@/lib/formats";
import { t, uiDir } from "@/lib/i18n";
import type { OpenRequest } from "@/lib/types";
import { formatColor } from "@/ui";
import { Plus, X } from "lucide-react";
import s from "./TabStrip.module.css";

export interface Tab {
	key: number;
	request: OpenRequest;
}

/**
 * The documents open in a desktop window, one tab each: the window's
 * top row, which also moves it and holds its own buttons. A click
 * shows a document, the cross (or the middle button) closes it, and
 * the plus goes back to Home to open another.
 */
export function TabStrip({
	tabs,
	current,
	onShow,
	onClose,
	onHome,
}: {
	tabs: Tab[];
	current: number | null;
	onShow: (tab: Tab) => void;
	onClose: (tab: Tab) => void;
	onHome: () => void;
}) {
	return (
		<nav
			className={s.strip}
			dir={uiDir()}
			aria-label={t("Open documents")}
			data-tauri-drag-region="deep"
			data-testid="tab-strip"
		>
			<div className={s.tabs} role="tablist" data-tauri-drag-region="deep">
				{tabs.map((tab) => {
					const on = tab.key === current;
					return (
						<div
							key={tab.key}
							className={`${s.tab} ${on ? s.on : ""}`}
							role="presentation"
							onAuxClick={(e) => {
								if (e.button === 1) onClose(tab);
							}}
							data-testid="tab"
						>
							<button
								type="button"
								role="tab"
								aria-selected={on}
								className={s.main}
								title={tab.request.name}
								onClick={() => onShow(tab)}
							>
								<span
									className={s.dot}
									style={{
										background: formatColor(formatFromName(tab.request.name)),
									}}
									aria-hidden="true"
								/>
								<span className={s.name} dir="auto">
									<span className={s.stem}>
										{splitName(tab.request.name)[0]}
									</span>
									<span className={s.ext}>
										{splitName(tab.request.name)[1]}
									</span>
								</span>
							</button>
							<button
								type="button"
								className={s.close}
								aria-label={t("Close {name}", { name: tab.request.name })}
								title={t("Close")}
								onClick={() => onClose(tab)}
								data-testid="tab-close"
							>
								<X size={14} />
							</button>
						</div>
					);
				})}
			</div>
			<button
				type="button"
				className={s.home}
				aria-label={t("Open another file")}
				title={t("Open another file")}
				onClick={onHome}
				data-testid="tab-home"
			>
				<Plus size={18} />
			</button>
		</nav>
	);
}

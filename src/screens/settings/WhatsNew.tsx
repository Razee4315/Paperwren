import { t } from "@/lib/i18n";
import { Sheet } from "@/ui";
import changelog from "../../../CHANGELOG.md?raw";
import s from "./Settings.module.css";

interface Release {
	version: string;
	items: string[];
}

/** CHANGELOG.md has "## version" headings and "- " lines, and nothing
 * else this needs a parser for. Part of the app, so it works offline. */
export function parseChangelog(text: string): Release[] {
	const releases: Release[] = [];
	for (const line of text.split(/\r?\n/)) {
		const heading = /^##\s+(.+)/.exec(line);
		if (heading) releases.push({ version: heading[1].trim(), items: [] });
		else if (line.startsWith("- "))
			releases[releases.length - 1]?.items.push(line.slice(2).trim());
	}
	return releases;
}

export function WhatsNew({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	return (
		<Sheet
			open={open}
			title={t("What's new")}
			onClose={onClose}
			wide
			testId="whats-new"
		>
			<div className={s.changes} dir="ltr">
				{parseChangelog(changelog).map((release) => (
					<section key={release.version}>
						<h3>{release.version}</h3>
						<ul>
							{release.items.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</Sheet>
	);
}

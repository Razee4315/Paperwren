// First, before any other code: fills what an older WebView lacks.
import "./lib/compat";
// Then the start-up trace: it marks the first script running.
import "./lib/traceBoot";
import "@fontsource-variable/manrope";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
	isDesktop,
	isLinux,
	isMac,
	isTouch,
	ownsFrame,
	sharesFrame,
} from "./lib/env";
import { language, loadLanguage } from "./lib/i18n";
import { followNativeInsets } from "./lib/insets";
import { traceMark } from "./lib/trace";
import { watchWindow } from "./lib/windowState";
import { KeyboardGroups } from "./ui/KeyboardGroups";

traceMark("code loaded");
followNativeInsets();
document.documentElement.classList.toggle("touch", isTouch);
document.documentElement.classList.toggle("desktop", isDesktop);
document.documentElement.classList.toggle("frame", ownsFrame);
document.documentElement.classList.toggle("lights", sharesFrame);
document.documentElement.classList.toggle("mac", isMac);
document.documentElement.classList.toggle("linux", isLinux);

// The first screen is drawn in the language last used, so its table is
// fetched first (English needs none); a failure still starts the app.
const root = document.getElementById("root");
if (root) {
	loadLanguage(language())
		.catch(() => {})
		.finally(() =>
			createRoot(root).render(
				<StrictMode>
					<KeyboardGroups />
					<App />
				</StrictMode>,
			),
		);
}

// The shell put the window back where it was left before showing it
// (placement.rs); from here its place is kept saved as it changes. Not
// waited for: the first screen does not depend on it.
watchWindow().catch(() => {});

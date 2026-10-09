import "@fontsource-variable/manrope";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isDesktop, isTouch, ownsFrame, sharesFrame } from "./lib/env";
import { language, loadLanguage } from "./lib/i18n";
import { restoreWindow } from "./lib/windowState";

document.documentElement.classList.toggle("touch", isTouch);
document.documentElement.classList.toggle("desktop", isDesktop);
document.documentElement.classList.toggle("frame", ownsFrame);
document.documentElement.classList.toggle("lights", sharesFrame);

// The window goes back to where it was left; a slow answer from the
// shell must not hold up the first screen.
const placed = Promise.race([
	restoreWindow().catch(() => {}),
	new Promise((resolve) => window.setTimeout(resolve, 400)),
]);

// The first screen is drawn in the language last used, so its table is
// fetched first (English needs none); a failure still starts the app.
const root = document.getElementById("root");
if (root) {
	Promise.all([loadLanguage(language()).catch(() => {}), placed])
		.catch(() => {})
		.finally(() =>
			createRoot(root).render(
				<StrictMode>
					<App />
				</StrictMode>,
			),
		);
}

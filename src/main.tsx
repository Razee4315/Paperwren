import "@fontsource-variable/manrope";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTouch } from "./lib/env";
import { language, loadLanguage } from "./lib/i18n";

document.documentElement.classList.toggle("touch", isTouch);

// The first screen is drawn in the language last used, so its table is
// fetched first (English needs none); a failure still starts the app.
const root = document.getElementById("root");
if (root) {
	loadLanguage(language())
		.catch(() => {})
		.finally(() =>
			createRoot(root).render(
				<StrictMode>
					<App />
				</StrictMode>,
			),
		);
}

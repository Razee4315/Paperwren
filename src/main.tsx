import "@fontsource-variable/manrope";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTouch } from "./lib/env";

document.documentElement.classList.toggle("touch", isTouch);

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

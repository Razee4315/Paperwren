import { useEffect, useState } from "react";

/** Delay animated feedback without delaying the operation itself. */
export function useDelayed(active: boolean, delay = 200) {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		setShown(false);
		if (!active) return;
		const timer = window.setTimeout(() => setShown(true), delay);
		return () => window.clearTimeout(timer);
	}, [active, delay]);
	return active && shown;
}

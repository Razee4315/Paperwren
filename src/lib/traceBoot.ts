// Imported first (after the compat fill) by main.tsx, so this runs before
// the rest of the app's code is evaluated: the time it reports is the
// page's first script running (PAPERWREN_TRACE, lib/trace.ts).
import { traceFirstPage, traceMark } from "./trace";

traceMark("page loaded");
traceFirstPage();

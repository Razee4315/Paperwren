/**
 * pdf.js's worker, built with the app rather than copied as it ships,
 * so it is lowered to the same older Chromium and gets the same gaps
 * filled (see compat.ts) before pdf.js starts.
 */
import "./compat";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";

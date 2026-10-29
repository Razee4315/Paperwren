# Rendering fidelity diagnostics

These are **remaining-limit diagnostics**, separate from the normal regression suite. Passing reproduces a documented limitation; it does not mean the behavior is desirable. Fixed cases have moved to `src/lib/__tests__/renderingFidelity.test.ts` and `tests/e2e/fidelity.spec.ts`, where passing verifies the intended behavior. The encoding diagnostic documents the automatic guess; the new explicit encoding selector resolves that ambiguity.

Run from the repository root; no production build is needed:

```powershell
npm ci --no-audit --no-fund
npm test
npx vitest run --config tests/audit/vitest.config.ts
npm run dev -- --host 127.0.0.1
```

The diagnostic suite reuses existing ZIP fixtures, changes narrowly targeted XML, and generates two ignored files:

- `public/fixtures/audit/transparency.pptx`
- `public/fixtures/audit/pagination.docx`

These are parser/layout probes, not schema-certified Office reference decks. Open representative authored decks in PowerPoint as part of fix acceptance. The local tests do not require Office or run it.

## Browser reproduction

Open `http://127.0.0.1:1420/?desktop`, dismiss onboarding, and use **Open file** with the generated files. The existing browser test hook can deliver a generated fixture too:

```js
const response = await fetch('/fixtures/audit/transparency.pptx');
window.__paperwrenTestFile = new File(
  [await response.arrayBuffer()], 'transparency-audit.pptx'
);
// Then click Open file.
```

For transparency, inspect the first slide. The red shape's computed fill is `rgba(255, 0, 0, 0.25)`. The loaded picture now has computed opacity `0.25`, matching `alphaModFix amt="25000"`; wrappers retain opacity `1`.

For Word, open `pagination.docx` in page view. It contains 100 paragraphs and A4 page settings. The live app reported `/ 1` and rendered one page section measuring 3052.5px high in the audited viewport; exact height can vary with fonts/viewport.

For JSON, supply this through the same file picker/test hook:

```js
window.__paperwrenTestFile = new File(
  ['{"id":9007199254740993}'], 'precision-audit.json'
);
```

The app now preserves `9007199254740993`. Do not use JavaScript to construct the numeric object first—the raw string is necessary to preserve the input value.

## Browser regression checks without a local build

```powershell
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
npx playwright test --config playwright.dev.config.ts tests/e2e/fidelity.spec.ts --workers=1
```

`playwright.dev.config.ts` uses Vite development mode. GitHub's existing Validate workflow uses the production build and runs all browser tests. Neither command above builds the application. For a preinstalled Chromium, set `PW_CHROMIUM` to its executable path.

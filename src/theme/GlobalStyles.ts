import { createGlobalStyle } from "styled-components";
import { font, motion } from "./tokens";

/**
 * Color themes are CSS variable sets. data-theme="paper" (light) and
 * data-theme="midnight" (dark); .pure-black on <html> swaps the two
 * darkest surfaces for OLED. Components read only variables.
 */
export const GlobalStyles = createGlobalStyle`
  :root {
    --font-ui: ${font.ui};
    --font-display: ${font.display};
  }

  :root,
  [data-theme="paper"] {
    --bg: #FAF7F2;
    --surface: #FFFFFF;
    --surface-2: #F1ECE3;
    --surface-3: #E9E2D4;
    --border: #E5DDCD;

    --ink-1: #211B15;
    --ink-2: #5E564A;
    --ink-3: #8F8574;
    --on-accent: #FFFFFF;

    --accent: #D95430;
    --accent-strong: #C24322;
    --accent-deep: #9E3517;
    --accent-container: #FAE4DA;
    --accent-tint: #FDF3EF;

    --success: #3D8F5F;
    --warning: #E8A13A;
    --danger: #CC4433;
    --info: #4A7DC4;

    --fmt-pdf: #D95430;
    --fmt-pdf-container: #FAE4DA;
    --fmt-docx: #3B6BC7;
    --fmt-docx-container: #E1E9F8;
    --fmt-xlsx: #3F9463;
    --fmt-xlsx-container: #DFF2E6;
    --fmt-pptx: #E8A13A;
    --fmt-pptx-container: #FBEDD4;

    --shadow-1: 0 1px 3px rgba(60, 42, 20, 0.08), 0 4px 12px rgba(60, 42, 20, 0.06);
    --shadow-2: 0 -2px 12px rgba(60, 42, 20, 0.10);
    --shadow-3: 0 6px 24px rgba(60, 42, 20, 0.14);
    --scrim: rgba(33, 27, 21, 0.4);
    --status-bar-content: dark;
    color-scheme: light;
  }

  [data-theme="midnight"] {
    --bg: #161310;
    --surface: #201C17;
    --surface-2: #2A251E;
    --surface-3: #342E25;
    --border: #3B342A;

    --ink-1: #F2EDE4;
    --ink-2: #BCB2A3;
    --ink-3: #83796A;
    --on-accent: #FFF6F1;

    --accent: #F06A45;
    --accent-strong: #D95430;
    --accent-deep: #B24626;
    --accent-container: #3A1F15;
    --accent-tint: #2A1710;

    --success: #63B583;
    --warning: #F0B45C;
    --danger: #E86A5A;
    --info: #7FA7DB;

    --fmt-pdf: #F06A45;
    --fmt-pdf-container: #3A1F15;
    --fmt-docx: #7DA2E4;
    --fmt-docx-container: #17263F;
    --fmt-xlsx: #6FBC90;
    --fmt-xlsx-container: #12291C;
    --fmt-pptx: #F0B45C;
    --fmt-pptx-container: #332711;

    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --scrim: rgba(0, 0, 0, 0.55);
    --status-bar-content: light;
    color-scheme: dark;
  }

  html.pure-black {
    --bg: #000000;
    --surface: #0C0A08;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-tap-highlight-color: transparent !important;
  }

  html {
    height: 100%;
    scroll-behavior: smooth;
  }

  html.mobile body {
    overflow-x: hidden;
    overflow-x: clip;
  }

  body {
    font-family: ${font.ui};
    font-size: 0.9375rem;
    line-height: 1.47;
    color: var(--ink-1);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    height: 100%;
    overflow: hidden;
    transition: background-color ${motion.dur.fast} ${motion.ease.standard};
  }

  #root {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  button, input, select, textarea {
    font-family: inherit;
  }

  /* 16px minimum on touch devices: smaller fields make mobile
     browsers zoom the page on focus */
  html.mobile input,
  html.mobile textarea,
  html.mobile select {
    font-size: 16px;
  }

  input:not([disabled]), textarea:not([disabled]) {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  ::selection {
    background: var(--accent-container);
    color: var(--ink-1);
  }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--ink-3); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

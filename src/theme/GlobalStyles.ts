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
    --scrollbar: rgba(33, 27, 21, 0.22);
    --scrollbar-active: rgba(33, 27, 21, 0.4);
    --status-bar-content: dark;
    color-scheme: light;
  }

  [data-theme="sepia"] {
    --bg: #F4EDE1;
    --surface: #FCF8F0;
    --surface-2: #EBE2D0;
    --surface-3: #E0D5BE;
    --border: #D8CBB2;

    --ink-1: #33291C;
    --ink-2: #6B5D48;
    --ink-3: #998C75;
    --on-accent: #FFF8F2;

    --accent: #C0562F;
    --accent-strong: #A8461F;
    --accent-deep: #7E3315;
    --accent-container: #F2E0D2;
    --accent-tint: #F9F0E7;

    --success: #4A8A5C;
    --warning: #C98F2E;
    --danger: #B84A38;
    --info: #4A70B0;

    --fmt-pdf: #C0562F;
    --fmt-pdf-container: #F2DFD0;
    --fmt-docx: #3E66A8;
    --fmt-docx-container: #DCE4F0;
    --fmt-xlsx: #3B7D52;
    --fmt-xlsx-container: #DAEAD9;
    --fmt-pptx: #B5832E;
    --fmt-pptx-container: #F2E6CC;

    --shadow-1: 0 1px 3px rgba(80, 60, 35, 0.10), 0 4px 12px rgba(80, 60, 35, 0.07);
    --shadow-2: 0 -2px 12px rgba(80, 60, 35, 0.12);
    --shadow-3: 0 6px 24px rgba(80, 60, 35, 0.16);
    --scrim: rgba(40, 30, 18, 0.42);
    --scrollbar: rgba(51, 41, 28, 0.25);
    --scrollbar-active: rgba(51, 41, 28, 0.42);
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
    --scrollbar: rgba(242, 237, 228, 0.18);
    --scrollbar-active: rgba(242, 237, 228, 0.32);
    --status-bar-content: light;
    color-scheme: dark;
  }

  [data-theme="moss"] {
    --bg: #141810;
    --surface: #1B2116;
    --surface-2: #242B1D;
    --surface-3: #2E3625;
    --border: #3A4330;

    --ink-1: #EFEDE2;
    --ink-2: #BFBFA9;
    --ink-3: #8A8A75;
    --on-accent: #1F220F;

    --accent: #D9A03F;
    --accent-strong: #C08D2E;
    --accent-deep: #97701F;
    --accent-container: #38301A;
    --accent-tint: #2A2514;

    --success: #7FB069;
    --warning: #E3B357;
    --danger: #E07A5F;
    --info: #8FAE9D;

    --fmt-pdf: #E08D5F;
    --fmt-pdf-container: #38291C;
    --fmt-docx: #8FAFD6;
    --fmt-docx-container: #20293A;
    --fmt-xlsx: #93BE8F;
    --fmt-xlsx-container: #1F3220;
    --fmt-pptx: #D9B45F;
    --fmt-pptx-container: #383018;

    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --scrim: rgba(0, 0, 0, 0.55);
    --scrollbar: rgba(239, 237, 226, 0.18);
    --scrollbar-active: rgba(239, 237, 226, 0.32);
    --status-bar-content: light;
    color-scheme: dark;
  }

  [data-theme="slate"] {
    --bg: #131417;
    --surface: #1A1C20;
    --surface-2: #23262B;
    --surface-3: #2D3138;
    --border: #3A3F47;

    --ink-1: #ECEDEF;
    --ink-2: #B4B7BD;
    --ink-3: #7F848C;
    --on-accent: #0F141B;

    --accent: #8AA6C4;
    --accent-strong: #7392B3;
    --accent-deep: #5A7691;
    --accent-container: #232B36;
    --accent-tint: #1A2028;

    --success: #6FAE8B;
    --warning: #DBAE5E;
    --danger: #DD7263;
    --info: #7FA3D0;

    --fmt-pdf: #D98267;
    --fmt-pdf-container: #332622;
    --fmt-docx: #93A8CC;
    --fmt-docx-container: #232A38;
    --fmt-xlsx: #8FBF9A;
    --fmt-xlsx-container: #1F3026;
    --fmt-pptx: #D9BC6B;
    --fmt-pptx-container: #332E1E;

    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --scrim: rgba(0, 0, 0, 0.55);
    --scrollbar: rgba(236, 237, 239, 0.18);
    --scrollbar-active: rgba(236, 237, 239, 0.32);
    --status-bar-content: light;
    color-scheme: dark;
  }

  html.pure-black {
    --bg: #000000;
    --surface: #0C0A08;
  }

  /* Shared keyframes: screens fade-and-rise in, list items follow
     with a small stagger. Reduced motion collapses these globally. */
  @keyframes pw-screen-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.995);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes pw-item-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
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

  /* Modern scrollbars: slim overlay-style bars with a theme-aware
     thumb. On touch they disappear entirely; motion is the
     affordance, exactly like every native mobile app. */
  * {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar) transparent;
  }
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track,
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar);
    border-radius: 999px;
    background-clip: content-box;
    border: 1.5px solid transparent;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-active);
  }
  html.mobile * {
    scrollbar-width: none;
  }
  html.mobile ::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

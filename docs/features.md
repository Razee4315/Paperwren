# Everything Paperwren does

The long version. The short one is in the [README](../README.md).

## Contents

- [What it opens](#what-it-opens)
- [Around the document](#around-the-document)
- [Tools](#tools)
- [Notes](#notes)
- [On Windows](#on-windows)
- [On a Mac](#on-a-mac)
- [Zoom and keyboard](#zoom-and-keyboard)
- [Look and feel](#look-and-feel)
- [Privacy](#privacy)

## What it opens

| Format | How it is shown |
|---|---|
| PDF | pdf.js viewer: fast virtualised pages, text selection, find with highlights, contents, rotate, two pages side by side, password-protected files. Its character maps and standard fonts ship with the app, so Chinese, Japanese and Korean files that name a font without carrying it still read. Go to a page by number (or by the document's own label, such as "iv"), pick one from the page thumbnails, or drag the handle on the right edge. A form is shown as it was saved; nothing can be typed into it and lost. A long file asks which pages to print before it draws any. **Page view** lays the pages down one long scroll, in a row turned sideways, or one (or two) at a time on their own, turned by key, swipe, wheel, a tap on either side or, with a mouse, arrows beside the page; a page zoomed past the screen is read to its foot first. Down a scroll, Page Down and Space stop at the top of each new page. **Crop margins** trims the empty edges every page shares, and **Save a cropped copy** writes a new PDF that opens cropped in other readers too. A link to another page leaves a "Back to page n" chip, and Back and Alt+Right walk that trail. The side panel lists a file's comments and highlights, its attached files (which open in the app) and its layers, which can be switched off. Details give the page size, the PDF version and whether its author forbids copying |
| Word `.docx` | The document's own page layout (docx-preview), fit to width, find, "3 / 12" page counter and go to page, and a list of its headings to jump by. **Reading view** lets the text flow to the width of the screen instead, for a phone. Comments can be shown when a document has them. Long documents only lay out the pages near the screen. Details show its title, author, dates, who changed it last and its word count, for every Office and OpenDocument file |
| Excel `.xlsx` `.xlsm` `.xlsb`, `.xls`, `.ods`, `.csv` `.tsv` | Virtualised grid: frozen rows and columns, merged cells, sheet tabs, find across every sheet, go to a cell by its address, zoom that keeps the headers pinned. Select a range (drag, shift-click, or the corner grip on touch) to copy it and see its sum, average and count. Drag a column edge to resize, double-click to fit. `.xlsx` cells keep their bold/italic, text colours, fills, borders and alignment; long text runs over empty neighbours; charts and pictures on a sheet are drawn where the file puts them. A cell's link and its note are shown beside the cell. Sheets a workbook hides stay hidden, and so do the gridlines of a sheet drawn without them (a switch brings them back). **Conditional formatting** is applied to the values the file saved: highlight rules that compare with a number or text, text rules, and colour scales. A column can be **sorted or filtered** for reading; the file is not changed, the header stays put and each row keeps its address. A CSV can be read in another text encoding |
| PowerPoint `.pptx` | Slides drawn from their own shapes, theme colours, layouts, freeform outlines, gradients, shadows, cropped pictures and tables, plus speaker notes. Bar, line, area, pie, doughnut and scatter charts are drawn from the numbers stored in the file; SmartArt is drawn from the shapes the file saved for it. Jump to a slide by its number or pick it from a grid of small slides. The slide show takes the whole screen, one slide at a time (on a phone it hides the status bar and turns the screen sideways): swipe, tap a side, click, or use the arrow keys; it passes over slides the author hid, and can show the speaker notes. **Presenter view** (P) shows the slide, the next one, the notes, a stopwatch and the time; the **laser pointer** (L) turns the pointer or a finger into a red dot |
| Books `.epub` | Chapters in one flowing column in a reading face, with the book's contents, its pictures, footnote links, find, bookmarks and read aloud. A book locked by its store (DRM) says so instead of showing nonsense |
| Legacy `.doc`, OpenDocument `.odt` | A flowing document with its formatting, lists, tables and pictures (the page layout is not reproduced, and the viewer says so). Word 6/95 files and `.rtf` show their text |
| Legacy `.ppt`, OpenDocument `.odp` | Drawn as slides, like `.pptx`: shapes, text, pictures, tables and backgrounds |
| Markdown, text, logs, JSON, XML, source code | Rendered Markdown (sanitised; its source is a tap away) with a list of its headings and TeX maths (`$…$`, `$$…$$`) drawn by KaTeX, or plain text with encoding detection. Source code in some thirty languages has its syntax coloured. JSON opens as a tree that folds, keeping every digit and repeated key; XML written on one line is laid out for reading. Long lines wrap or keep their length, and lines can be numbered. A script is shown, never run or handed to another app |
| Pictures `.png` `.jpg` `.gif` `.webp` `.bmp` `.svg` `.avif` `.heic` `.tif` | Fitted to the screen, zoomable, and turned the right way up when taken sideways: a scan or a photo of a page is a document too. A multi-page TIFF turns its pages; arrows step through the other pictures in the folder; a picture can be turned or flipped. Details show the camera, the lens, when and how it was taken. An SVG's scripts never run. Android draws HEIC photos the webview cannot |
| Comic books `.cbz` | Its pages in order, one at a time, by swipe, tap or key, remembered where you stopped |
| Contact cards `.vcf` | A list of contacts, each a card with its name, photo, organisation, phones, emails, addresses, websites, birthday and note. Tap a detail to copy it; find searches across them. vCard 2.1, 3.0 and 4.0 are read. Nothing is added to the phone's contacts, so no permission is asked |
| 3D models `.glb` | Turn the model by dragging, zoom by pinch or wheel, move it sideways, reset the view, and play the animations it has. Models squeezed with Draco, meshopt or KTX2 are not shown, and the viewer says so. Nothing is fetched |

Password-protected `.docx`, `.xlsx` and `.pptx` files open with their password (both the Office 2007 and the Office 2010+ encryption). The password is used in memory, once, and never stored. Protected `.doc`/`.xls`/`.ppt` files, and files locked with a certificate or rights management, are not opened; the app says so.

Right-to-left text (Arabic, Urdu, Hebrew) reads from the right in slides, documents, text files and sheet cells, whether or not the file says so.

The bytes decide the format, not the file name: content URIs without extensions and files with the wrong extension still open in the right viewer.

## Around the document

- **Highlights and notes while reading a PDF**: select words and tap a colour, or underline, strike out or add a note. That's all: there is nothing to save. Marks are found again by the file's content, so they follow it through a rename or a move, and the file itself is never changed. Tap a mark to recolour it, note it or remove it. **Highlights** lists everything marked in the document, in reading order, with a note for the whole document; copy it all as Markdown, save it as a file, add it to Notes, or save a PDF copy with the marks in it. They go on paper when you print, and into your notes backup. A PDF opened with a password keeps nothing unless you save a copy.
- **A scan offers to be read**, and a page with a signature field or a line for signing offers Fill & sign, right where you're reading.
- **Search results** can be listed together, page by page, with the words around each.
- **A picture in a PDF** opens large, sharp and on its own: click it, or press and hold on a phone.
- **The file menu** in every viewer: share (or save a copy), open in another app, show in folder, print, details. What a platform cannot do is left out rather than greyed out.
- **Print** lays the whole document out again for paper, including pages that were never scrolled into view.
- **Folders**: pick a folder on Home to browse the documents inside it, with the same search and type filters as recents.
- **Large files**: a file big enough to be slow, or to be more than a phone can hold, asks before it is read. A sheet with more cells than can be held is shown up to its last whole row that fits, and says so.
- **Links** in a document are never followed (the app has no network access): a link within the document scrolls to its target, and a web or mail address is shown so it can be copied.
- **Bookmarks**: Ctrl+D (or the menu) marks the place, named after its page, slide or the words at the top of the screen; they are listed in the menu and the side panel, per file.
- **Read aloud** with the device's own voices (only those that work offline), sentence by sentence with the words highlighted, at the pace chosen. It starts where you are reading.
- **Page colour**: original, sepia, dark or the theme's own paper, for PDFs, documents and books; the pictures in a page keep their colours.
- **Reading font**: books, Markdown and reading view as written, in a serif or in a sans serif.
- **On a phone**: turn pages with the volume keys or a tap on the edges of the screen, let the bars step aside while reading (**Bars while reading** in Settings: Always, Auto-hide or Tap only), go **Full screen** from the ⋮ menu, find the controls in a rail at the side when the phone is held sideways, dim the screen further than its own lowest brightness, or let the document scroll by itself.
- **Find** can match case and whole words.
- **Back after "Open with"** (Android): Back on a file another app opened returns to that app.
- **Recents** can be sorted by last opened, name or size; removing one, clearing them or turning them off can be undone for a few seconds. A file reopens at the page and zoom it was left at.
- **Keep the screen on** while a document is open (off by default; no permission needed).
- **Languages**: English, 中文, हिन्दी, Español, Français, Português (Brasil), Русский, العربية and اردو, following the phone or chosen in Settings. Arabic and Urdu mirror the app; documents keep their own direction. See [Translations](development.md#translations).

## Tools

The PDF jobs people otherwise upload to a website for, on the device. Open them from **Tools** on Home, from a PDF's menu (**Fill & sign**, **Mark up**, **More PDF tools**), or from a photo's (**Scan this photo**). Each tool saves a new file where you choose, in the system's own save screen; the files you started with are not changed.

| Tool | What it does |
|---|---|
| Scan a document | Paper to a PDF. Take a photo with the phone's camera, or choose photos already taken (several at once). The page's edges are found by themselves and can be dragged into place, with a magnifier beside the finger; the page is straightened, then given a look: clean (the paper made evenly white, shadows and colour casts taken out), the original, grey, or black & white, and turned if need be. Pages are reordered, changed or removed, then saved together, as scanned or on A4 or Letter. A small "Scanned with Paperwren" line at the foot of each page goes with one switch, and stays off |
| Fill & sign | The form's own fields can be typed into, ticked and chosen. Anywhere on a page you can put a signature or initials, a stamp, a line of text, the date, a tick or a cross, and move, resize or remove them; a signature field in the form is a "Sign here" box. A signature is drawn with a finger, pen or mouse, typed in a handwriting face, or uploaded: a PNG with a clear background is used as it is, a photo of one on paper has its paper cleared evenly and its ink keeps its colour (**Lighter** and **Darker** adjust it; **Keep colours** or **One ink** chooses between the pads). A stamp is made from words (APPROVED, PAID or your own) in red, blue, green or black, square or round, with the date if wanted, or uploaded as a PNG or a photo, with the same Lighter, Darker, Keep colours and One ink. Signatures and stamps can be kept on the device for next time. The copy keeps the fields as fields, or makes them part of the page. Marks stay upright on pages the file turns, and text in a script the standard PDF fonts lack is drawn as a picture. A PDF whose author forbids changes says so instead |
| Mark up | Write and draw on the pages with a finger, stylus or mouse, in a colour and thickness you choose. A felt marker colours over anything; **Highlight text**, **Underline** and **Strike out** follow the words as you drag across them. Notes sit where you tap, and **text boxes** take any language. **Measure** gives lengths and areas on a plan: at the page's real size, or at a scale you set by drawing along something of a known length, page by page. An eraser, undo and redo. What you make here is kept with the document, the same as highlights made while reading. One finger writes and two scroll and zoom; once a stylus touches the page, a finger only scrolls. The marks are saved as the PDF's own annotations, so other apps can show, list, change or remove them. A PDF whose author forbids changes says so instead |
| Compress PDF | A smaller copy: its pictures stored again at the quality you choose, or at whatever fits a size you aim for (200 KB, 500 KB, 1 MB, 2 MB or one you type), and only where that saves something. **Turn pages into pictures** is offered when the text alone is too big for the size (the text can then no longer be selected), and **Keep quality (lossless)** keeps every picture as it is. Text stays text, and what a JPEG would change (masks, CMYK and palette pictures) is left alone. If a file cannot get smaller, no copy is made and the app says so |
| Read text | The words of a PDF, a scan or a photo, on the screen. You watch each page being read: a line sweeps down it as the engine works, the lines light up where they were found, and the text gathers beside the page. Tap a line to see where it came from; words the engine wasn't sure of are underlined. Copy it all, save it as text, add it to Notes, or save a searchable PDF: a copy with the words laid unseen over each page, which looks the same. Stop whenever you like and keep what's been read; pages already read are never read twice. A page with words of its own gives them straight away. Reads English, Spanish, French, Portuguese, Russian, Arabic, Urdu, Hindi and Chinese with [Tesseract](https://github.com/tesseract-ocr/tesseract), on the device. Clear print reads best; Nastaliq Urdu and handwriting come out with mistakes |
| Merge PDFs | Several PDFs as one, in the order you set. Pick many at once, and use **Sort by name** to put them in order |
| Organize pages | Turn, move or take out pages, picked from thumbnails |
| Split or extract pages | Pages typed as "1-3, 5" as a new PDF, or every page as its own PDF in a ZIP |
| Pictures to PDF | Photos or scans (any format the app opens), picked many at once and put in order with **Sort by name**, as pages: A4, Letter, or each picture's own size |
| PDF to pictures | Pages as JPEG pictures at 150 dpi (several in a ZIP) |
| Page numbers, watermark | "1" or "Page 1 of 9" at the foot or top of every page; a word such as DRAFT across them |
| Add or remove a password | A copy that asks for a password to open, or one that no longer does (if you know it) |

Any file can also be **renamed**, from its menu or a recent's: the extension stays as it is. On a desktop the file itself is renamed in its folder, never over another file. On a phone a file opened from a folder you added, a copy you saved, or a file picked with Open file, is renamed where it is when the phone allows it (the app keeps access to a picked file for as long as Recent files lists it). A file opened from another app is a copy the app holds, as is a picked file whose place will not let it be renamed, so the new name is the one it goes by in the app and is shared by, and the rename says so before and after: the original keeps its name. This answers [issue #10](https://github.com/Razee4315/Paperwren/issues/10).

The tools are built on [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (the maintained fork), loaded only when one runs.

The scanner finds the page with two finders that run on the device: a small neural network, [DocCornerNet](https://github.com/mapo80/DocCornerNet-CoordClass) (1.9 MB, on a trimmed ONNX Runtime, from [scanic-ml](https://www.npmjs.com/package/scanic-ml)), which finds a page against a busy desk or one as pale as the table, and [scanic](https://github.com/marquaye/scanic)'s edge tracer, the more exact of the two when the page stands out. Both ship with the app; nothing is fetched. "Take a photo" hands the job to the phone's own camera app, so Paperwren asks for no camera permission.

## Notes

**Notes** on Home keeps what you write, on this device: typed text and sheets of handwriting in one note, in any language, saved as you go and found by searching their words. A note can be saved as a PDF (drawn as pictures of its pages, so every script comes out as written, but the words cannot be selected). Notes go with the app if it is removed, so **Back up all notes** saves them all to one file, and **Bring back from a backup** adds them back, keeping whichever copy of a note was changed last. This answers [issue #40](https://github.com/Razee4315/Paperwren/issues/40).

## On Windows

The same web layer, laid out for a mouse and a keyboard:

- **One bar.** The app draws the window's frame itself, so the bar that names the document is also the title bar: back, the file's name, the page number, zoom, find, the menu, and the window's own buttons. Drag it to move the window, double-click it to maximise. Nothing sits at the foot of a document except a workbook's sheet tabs.
- **One window.** A file opened while Paperwren is running becomes a tab in the window that is already there, on Windows and on Linux.
- **Tabs.** Each document opened is a tab in the window's top row: Ctrl+Tab moves between them, Ctrl+1 to Ctrl+9 picks one, Ctrl+W or a middle click closes it, and the plus goes back to Home for another. Tabs can be dragged into another order, moved with Ctrl+Shift+Page Up and Ctrl+Shift+Page Down, and have a right-click menu. Several files dropped together open a tab each.
- **A side panel** that stays open while reading: a PDF's pages, contents, comments, attachments and layers, a Word document's or a Markdown file's headings, a deck's slides, and bookmarks.
- **A file changed by another app** while it is open says so, and reloads at the place you had reached.
- **Menus open at the pointer**, and a right click on selected text offers Copy, Select all and Find.
- **Full screen** for any document with F11; the bar returns while the pointer is at the top edge. It comes and goes in one calm fade.
- **The window opens where it was left**, as large as it was left. On Linux the document's name is shown once, in the window's title bar.
- Type a page number straight into the bar; the zoom level opens a menu of sizes.

## On a Mac

The desktop layout again, with the Mac's own manners:

- **The window keeps its three buttons**, over the left end of the bar, which is the title bar here too: drag it to move the window.
- **A menu bar** in the app's language. Its commands are the ones the keys give: Open File, Close, Print, Find, the zoom, Full Screen, Settings.
- **⌘ where Windows has Ctrl**, and the keys a Mac has in place of the ones its keyboard lacks: ⌃⌘F for full screen (which is the window's own, so the green button does the same), ⌘↑ and ⌘↓ for the start and the end of a document, ⌘G for the next match.
- **A pinch on the trackpad** zooms the document, about the point under the cursor.
- **Double-click a document in Finder**, or drop one on the Dock icon, and it opens in the window that is already there. Paperwren offers itself under "Open with" and takes no file type over: make it the default for one in Finder, under File, Get Info.

## Zoom and keyboard

Every viewer zooms the same way: pinch or double-tap on a touch screen, Ctrl+wheel with a mouse, Ctrl `+` `-` `0`, or the zoom control (in the top bar on Windows, at the foot of the screen on a phone). The point under your fingers or the cursor stays put, and the page follows without re-rendering until you let go. In the text-only viewers the same gestures change the text size.

On Windows the keyboard works from the moment a file opens, and keeps working after a click on the bar. The list is also in the app, under Settings, Keyboard.

| Keys | What they do |
|---|---|
| Ctrl+O | Open a file |
| Ctrl+W, Alt+Left | Close the document (or the tab). After a link in a PDF, Alt+Left (or a mouse's back button) goes back to where it was, Alt+Right (or its forward button) forward again |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1 to Ctrl+9 | The next, the previous or a given tab |
| Ctrl+Shift+Page Up, Ctrl+Shift+Page Down | Move the tab one place left or right |
| Ctrl+D | Bookmark this place |
| Ctrl+Shift+U | Read aloud |
| Ctrl+F | Find in the document (on Home: search your files) |
| F3, Shift+F3 (or Enter, Shift+Enter in the field) | Next and previous match. Esc closes the search |
| Ctrl+P | Print |
| Ctrl `+`, Ctrl `-`, Ctrl `0` | Zoom in, zoom out, back to the natural fit |
| F, F11 | Full screen. Esc leaves |
| H, N | With words selected in a PDF: highlight them, or add a note |
| D, T | PDF: draw on it, or add text |
| Ctrl+Z, Ctrl+Y | Undo and redo a mark |
| Delete | Remove the mark you clicked |
| R, 2 | PDF: rotate the pages, or show two side by side |
| ? | The list of keys |
| Space, Shift+Space, Page Up, Page Down, arrows | Scroll. Page Down and Space stop at the top of each new page |
| Home, End (also with Ctrl) | The start and the end of the document |
| Left, Right (on a Mac also ⌘[, ⌘]) | The previous and the next page, slide or picture |
| G | Go to a page: type its number, press Enter |
| Ctrl+A | Select the whole document |
| Ctrl `]`, Ctrl `[` (on a Mac ⌘R, ⌘L) | PDF: rotate the pages |
| F5 | Slides: start the slide show. A click or the wheel goes on, a right click goes back, Esc leaves |
| P, L | In a slide show: presenter view, the laser pointer |
| Arrows, Shift+arrows, Home, End, Page Up, Page Down, Enter | Sheets: move the selection (Shift extends it) |
| Ctrl+arrow, Ctrl+Home, Ctrl+End | Sheets: to the edge of the data, the first cell, the last cell |
| Ctrl+Page Up, Ctrl+Page Down | Sheets: the previous and the next sheet |
| Ctrl+C | Sheets: copy the selection |

## Look and feel

- Flat and calm: solid colours, no gradients, blur or drop shadows, and only short one-shot transitions.
- Three themes tuned for long reading, plus Auto (Paper by day, Ink at night):
  - **Paper**: warm off-white with a faint paper-fibre texture and a pine-teal accent.
  - **Sand**: low-blue-light parchment with a fine sand grain and a terracotta accent.
  - **Ink**: soft charcoal (not pure black) with ink splatters in the corners and a mint accent.
  Textures sit on page backgrounds only; cards and documents stay plain.

  ![The home screen in the Paper, Sand and Ink themes](screenshots/themes.jpg)
- A flat wren mascot (also the app icon), a four-step welcome with a live theme picker. Files opened from other apps skip it.
- Motion respects the system "reduce motion" setting.

The same app on Windows:

![Paperwren on Windows](screenshots/windows.jpg)

## Privacy

- No analytics. The Android app has no network access: the release APK requests zero Android permissions, and the release pipeline fails if one appears.
- On Windows and macOS, Paperwren asks once whether to check for updates. If you agree, it asks GitHub for the release feed when it starts and offers a new version; nothing about you or your files is sent. Updates are signed, and one whose signature does not match the key built into the app is refused. Turn it off, or check by hand, in Settings under Updates.
- Recents and settings live in app-private storage. On Android, files opened from the picker or shared into the app are kept as private copies (deduplicated by content hash, capped at 250 MB) so recents still reopen after the app is closed; they can be deleted in Settings.
- Passwords (PDF and Office) are used once, in memory, and never stored.
- A signature, initials or stamp you ask to keep are stored as pictures in app-private storage, and can be forgotten whenever you sign or in Settings.
- Scanning asks for no camera permission: the phone's camera app takes the photo. The photos are worked on in memory; the copy the camera app writes into the app's own folder is deleted the next time the app starts.
- Notes are stored in app-private storage and go nowhere unless you save one as a PDF or back them up, which writes a file where you pick it.
- The app never changes a file it opened. It writes only a copy a tool made, where you pick it in the system's save screen (never over a file you have open: it says so and asks again), and a file you rename. On a desktop both are done by the Rust side (`src-tauri/src/save.rs`), which checks the name: the web layer's file access stays read-only.

The full policy is at [razee4315.github.io/Paperwren/privacy](https://razee4315.github.io/Paperwren/privacy).

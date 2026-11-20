# What's new

## 1.9.0

- Large PDFs stream a piece at a time instead of loading whole into memory, fixing crashes on very large files and scanned picture PDFs and showing the first page sooner.
- Hide or show highlights on the page from the Highlights panel while keeping your notes open beside the document.
- Android: files chosen with Open file open directly without copying into app storage, managed copies are pruned during long sessions, and files opened from other apps stay out of Recents and return cleanly on Back.
- Android: rotating from landscape to portrait keeps your page, duplicate scrollbars are hidden, and the edge scrubber ignores accidental touches while scrolling.
- Desktop: the window opens already placed and coloured in your saved theme with no light flash, `Ctrl+,` (`Cmd+,` on macOS) opens Settings, and many open tabs scroll cleanly instead of clipping.
- Every close path (tab X, `Ctrl+W`, Back, window close) asks before dropping unsaved edits, and failed saves or deletes keep your data and offer Try again.
- Clicking a section in Settings highlights it straight away and keeps Updates and Privacy selected until you scroll by hand.
- Memory and speed: closing a PDF releases all its pages, hidden tabs let go of drawn canvases while keeping your place, tools release offscreen pages and pictures as you go, and search and menus respond faster.
- Accessibility: full Windows high-contrast (`forced-colors`) support, stronger borders and text contrast across all five themes, and arrow-key navigation across toolbars and tabs.
- Security and privacy: stricter archive, link and file-path checks across desktop and Android, cleared password fields on close, and no saved bookmarks for password-protected files.

## 1.8.0

- Bars while reading, in Settings: Always, Auto-hide or Tap only. On a phone the bars slide over the page without a stutter.
- Full screen on a phone, from the ⋮ menu. Held sideways, the controls move to a rail at the side and leave more room for the page.
- One window on Windows and Linux: a file opened while Paperwren runs becomes a tab. Tabs can be dragged into another order, moved with Ctrl+Shift+Page Up and Page Down, and have a right-click menu. Switching tabs is instant.
- Full screen on Windows goes in and out in one step, and Linux shows the document's name once, in the window's title.
- Merge PDFs and Pictures to PDF take many files in one pick, and Sort by name puts them in order.
- Compress PDF can aim for a size: 200 KB, 500 KB, 1 MB, 2 MB or one you type. When the text alone is too big, it can turn the pages into pictures. Keep quality (lossless) makes a file smaller without changing its pictures.
- Photos of a signature or stamp come out clean, in the ink's own colour, with Lighter and Darker, and Keep colours or One ink.
- Crop pages can save a cropped copy, which opens cropped in other apps too.
- Contact cards (.vcf) open as a list of contacts, and 3D models (.glb) open to be turned and zoomed.
- Android: Back on a file another app opened goes back to that app, and PDFs made from phone photos no longer show turned pages.
- Rename on a phone renames the file itself where Android allows it, and says so when only the name in Paperwren changes. A rename that fails says why.
- A copy of a password-protected PDF says it will open without the password, and PDFs that only limit copying or changes now work in the tools.
- On a computer, a saved copy can no longer go over a file you have open.
- Two quick presses of Esc or Back are no longer lost.

## 1.7.0

- Two documents side by side on a computer: ⋮ → Side by side. Click a half to work in it, drag the line between them, or swap sides.
- Crop by hand: drag the box on a page and apply it to all pages, odd or even pages, or just that page. Remembered for each file.
- Crop margins works on scanned pages, can leave out headers and page numbers, gives every page the same size, and says when there is nothing to crop.
- Fill & sign is simpler on a phone: Save at the top, Signature, Text, Date and Tick at the bottom, and the rest under More. One ink for everything, the signature too.
- Scrolling a form with a finger no longer drops extra signatures, and the signature pad fills a phone's screen.
- Typed signatures look the same on every device, in three handwriting styles, and the whole name always shows.
- Text you type on a phone is large enough to read while you type it.
- A full screen button in every viewer on a computer; full screen on Windows covers the whole screen, and Esc closes a dialog first.
- Auto, the theme the app starts with, is now plain Light or Dark, following your device.
- Word files with no page settings show on a normal page.
- Two recent files with the same name show their folder.
- A moved or deleted file on Windows says so; a file another app is using says "File in use".
- Markdown tables break between words, not in the middle of one.
- Small fixes: the Open file button no longer covers text on an empty Home, long menus show they scroll, and form fields no longer show twice in Fill & sign.
- Files open faster: PDFs show their first page sooner, and big spreadsheets, text files and Markdown no longer freeze the screen.
- A loading screen while Tools and Notes open, and a word of reassurance when a big file takes a while.
- Big folders open without freezing.
- Linux: an .rpm for Fedora.

## 1.6.2

- Read a PDF one page at a time: Page view, in the file's menu or in Settings.
- Change any keyboard shortcut in Settings.
- Smoother zoom, crisper text, and the first file opens twice as fast.
- A shorter menu, and Settings in sections.
- Fixed: the Close button of What's new and of menus on a phone, and the arrow keys after a click on a PDF.

## 1.6.1

- Two plain themes, Light and Dark: neutral white and near black, with no paper texture. Paper, Sand and Ink stay.
- On Windows and macOS everything is sized for a mouse: smaller buttons, fields, rows and tool cards, and tighter corners.
- Home and Settings line up with the window's own buttons.
- A long dialog in a short window keeps its buttons in view; only its middle scrolls.
- Notes have a proper place to write: a roomy box with a hint, the highlighted words above it in their colour, and Ctrl+Enter to keep the note.
- The bar on a highlight sits above it instead of over its words.
- Screens change with a short fade on a desktop instead of sliding.
- File details no longer say "PDF · PDF".
- Linux (beta): an AppImage and a .deb with every release.

## 1.6

- PDFs open on phones with an older web engine, such as Huawei phones without Google Play. Menus, search highlights, Read text and Scan work there too.
- When a file can't be shown because the phone's web engine is out of date, Paperwren says so, instead of calling the file damaged.
- Watermark: one mark or repeated across the page, in three sizes, three strengths and three colours, slanted or straight, on all pages or the ones you pick.
- Page numbers: start at any number, leave the first page without one, and choose the size and any corner or middle.
- PDF to pictures: JPEG or PNG, at screen, standard or print quality.
- Add a password: choose whether the copy can be printed, copied from or changed.
- Pictures to PDF: portrait or landscape, a choice of margin, and Legal paper.
- Fill & sign: black or blue ink for text, dates and ticks.
- Save a copy of the open file from its menu.
- iPhone photos (HEIC) open on Windows too, and on Android a photo no longer shows a broken picture before it appears.
- Word: tables that reach into the margin now fit the page, and pictures stored as EMF show.
- The highlighted choice in the tools now follows what you pick.

## 1.5

- Highlight while you read. Select words, tap a colour, and it's done. Your highlights, notes and drawings stay with the document on this device, and the PDF itself is never changed.
- Tap a highlight to change its colour, add a note or remove it.
- Every mark is listed under Highlights. Tap one to go there, or copy them all, save them as a file, or add them to Notes.
- Add a note about a whole document.
- Text boxes in Mark up, in any language.
- Read text replaces PDF to text and Make a scan searchable. Watch the pages being read, and get their words on the screen to copy. Saving is up to you.
- A scan now offers to be read, and a form offers to be signed.
- Measure lengths and areas on a plan, at the scale you set.
- See every search result at once, with the words around it.
- Tap a picture in a PDF to see it large.
- A warning before a copy would break a PDF's digital signature.
- A signature from a photo can be trimmed, and its ink made lighter or darker.
- Recent PDFs show their first page and how far you've read.
- Marks and printing now work with Crop margins on.

## 1.4

- Mark up: write on a PDF, highlight, underline and strike out words, and add notes.
- Notes: keep typed and handwritten notes on this device.
- Compress PDF, and text recognition for scans.
- Rename a file from its menu.

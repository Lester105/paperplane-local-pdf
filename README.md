# Paperplane — Local PDF Studio

A small, local-only PDF editor. It has no account, backend, analytics, cloud storage, or remote runtime assets. Opened PDFs and edits remain in the active tab's memory and are not saved automatically.

## Run locally

Install dependencies once, then start the app:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite (by default `http://127.0.0.1:5173`). To create and serve a production build on this computer:

```sh
npm run build
npm run preview
```

The generated static files are in `dist/`; the app only needs a local web server to serve them. Runtime JavaScript, the PDF.js worker, and styles are bundled with the app—there are no CDN requests.

## GitHub Pages deployment

The included GitHub Actions workflow builds and publishes `dist/` to GitHub Pages whenever changes are pushed to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions** for the repository. This publishes the app itself, not any of your PDFs: opened files and edits remain in the visitor's active tab and are never uploaded.

## Included

- Open and validate PDF files (PDF extension, signature, non-empty, under 100 MB).
- Scroll through pages while the page counter and thumbnail selection follow the most visible page; use the navigation buttons to jump between pages and zoom the document.
- Add and edit text overlays; choose Helvetica, Times New Roman, or Courier, size, color, bold, and italic.
- Add freehand pen marks and highlights with preset/custom colors; adjust ink width and opacity or highlight opacity, drag annotations to move them, and drag highlight handles to resize.
- Double-click text inside a text box in Select mode to edit it in place; the side panel exposes its properties. Resize highlights by dragging any edge or corner handle. Press `Delete` to remove the selected annotation. Undo and redo annotation/page edits with the toolbar buttons, `Ctrl+Z` and `Ctrl+Y` (`Cmd` equivalents on Mac).
- Rotate, reorder, duplicate, and delete pages; merge another PDF at the end.
- Export the edited document or download the current page as a separate PDF.

The **More tools** panel separates implemented functions from planned items. Compression, page-range splitting, watermarking, fill-and-sign, conversion, and OCR are not implemented yet.

Run the focused editor tests with `npm test`.

## Editing and privacy notes

Text added in Paperplane is an editable overlay in the current in-memory document and is written into the exported PDF. The original text already inside a PDF is **not** edited or reflowed; it remains as-is. Replacing embedded fonts throughout arbitrary PDFs is not reliably supported by this MVP. Added text uses the three bundled PDF standard fonts, not every font installed on the computer.

The app does not send or automatically store files anywhere. Your working PDF and edits stay in tab memory; closing or reloading the tab discards unexported changes. Use **Export PDF** to save a copy through the browser's normal download flow.

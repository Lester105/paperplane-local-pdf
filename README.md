# Paperplane — Local PDF Studio

A small, local-first PDF editor. It has no account, backend, analytics, cloud storage, or remote runtime assets. PDFs are opened by the browser and drafts are saved in that browser's local IndexedDB storage.

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

The included GitHub Actions workflow builds and publishes `dist/` to GitHub Pages whenever changes are pushed to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions** for the repository. This publishes the app itself, not any of your PDFs: opened files, edits, and drafts remain in the visitor's browser and are never uploaded.

## Included

- Open and validate PDF files (PDF extension, signature, non-empty, under 100 MB).
- View pages with thumbnails, navigation, and zoom.
- Add and edit text overlays; choose Helvetica, Times New Roman, or Courier, size, and color.
- Add freehand pen marks and highlights with preset/custom colors; click-drag to size a highlight or drag any edge/corner handle to resize it.
- Undo and redo annotation/page edits with the toolbar buttons, `Ctrl+Z` and `Ctrl+Y` (`Cmd` equivalents on Mac). Press `Delete` to remove the selected highlight.
- Rotate, reorder, duplicate, and delete pages; merge another PDF at the end.
- Export the edited document or download the current page as a separate PDF.
- Automatically save the current draft on this device. Use **Export PDF** to create a portable file in a location you choose.

The **More tools** panel separates implemented functions from planned items. Compression, page-range splitting, watermarking, fill-and-sign, conversion, and OCR are not implemented yet.

## Editing and privacy notes

Text added in Paperplane is an editable overlay in the current draft and is written into the exported PDF. The original text already inside a PDF is **not** edited or reflowed; it remains as-is. Replacing embedded fonts throughout arbitrary PDFs is not reliably supported by this MVP. Added text uses the three bundled PDF standard fonts, not every font installed on the computer.

The app does not send files anywhere. Drafts remain in this browser profile's IndexedDB until browser storage is cleared. Exported PDFs are saved through the browser's normal download flow. For important work, export a copy.


<h1 align="center">✈️ Paperplane — Local PDF Studio</h1>

<p align="center">
  <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/Vite-Build%20Tool-646CFF?logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://mozilla.github.io/pdf.js/"><img src="https://img.shields.io/badge/PDF.js-Rendering-FF6B6B" alt="PDF.js"></a>
  <a href="https://pages.github.com/"><img src="https://img.shields.io/badge/GitHub%20Pages-Deployed-222222?logo=github&logoColor=white" alt="GitHub Pages"></a>
  <img src="https://img.shields.io/badge/status-active-brightgreen" alt="Status">
</p>

<p align="center">
  A small, <b>local-only</b> PDF editor. It has no account, backend, analytics, cloud storage, or remote runtime assets. Opened PDFs and edits remain in the active tab's memory and are not saved automatically.
</p>

## 📌 What It Does

- **Local-Only Privacy** – No files are uploaded, sent, or stored remotely. Your working PDF and edits stay in tab memory. Closing or reloading the tab discards unexported changes.
- **Open & Validate** – Open PDF files with validation (extension, signature, non-empty, under 100 MB).
- **Navigation & Viewing** – Scroll through pages with a page counter and thumbnail selection that follow the most visible page; zoom and jump between pages.
- **Text Overlays** – Add and edit text overlays with Helvetica, Times New Roman, or Courier, including size, color, bold, and italic options.
- **Annotations** – Add freehand pen marks and highlights with preset/custom colors. Adjust ink width and opacity, drag to move, and drag handles to resize.
- **Page Management** – Rotate, reorder, duplicate, and delete pages; merge another PDF at the end.
- **Export & Download** – Export the edited document or download the current page as a separate PDF.

## 🛠️ Tech Stack & Frameworks

| Layer | Tool / Framework |
|---|---|
| **Build Tool** | Vite |
| **Language** | TypeScript |
| **PDF Engine** | PDF.js (bundled worker, no CDN) |
| **Deployment** | GitHub Actions → GitHub Pages |
| **Testing** | Focused editor tests via `npm test` |
| **Runtime** | 100% client-side (no backend/server required) |

## 🚀 Getting Started

### Prerequisites

No backend required—just Node.js.

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

Open the localhost URL printed by Vite (by default `http://127.0.0.1:5173`).

### Production Build

```bash
# Build static files
npm run build

# Preview the production build locally
npm run preview
```

The generated static files are in `dist/`; the app only needs a local web server to serve them. Runtime JavaScript, the PDF.js worker, and styles are bundled with the app—there are no CDN requests.

## 📁 Project Structure

```text
├── .github/workflows/       # GitHub Actions for Pages deployment
├── src/                     # Application source code (TypeScript)
├── index.html               # Entry HTML
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript root config
├── tsconfig.app.json        # App-specific TS config
├── tsconfig.node.json       # Node-specific TS config
├── package.json             # Dependencies and scripts
└── dist/                    # Generated static build (after npm run build)
```

## 🔒 Editing & Privacy Notes

- Text added in Paperplane is an **editable overlay** in the current in-memory document and is written into the exported PDF.
- The original text already inside a PDF is **not** edited or reflowed; it remains as-is.
- Replacing embedded fonts throughout arbitrary PDFs is not reliably supported by this MVP.
- Added text uses the three bundled PDF standard fonts, not every font installed on the computer.
- The app **does not send or automatically store files anywhere**. Use **Export PDF** to save a copy through the browser's normal download flow.

## 💡 Use Cases

- Quick, private PDF annotations without uploading sensitive documents to a cloud service.
- Lightweight text overlays and highlights on documents locally.
- A privacy-first alternative to online PDF editors.

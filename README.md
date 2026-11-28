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

import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Annotation, AnnotationMap, FontName, PageItem } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_PDF_SIZE = 100 * 1024 * 1024;
const STANDARD_FONTS: Record<FontName, StandardFonts[]> = {
  Helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  TimesRoman: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  Courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

export async function validatePdfFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a file with a .pdf extension.");
  }
  if (file.size === 0 || file.size > MAX_PDF_SIZE) {
    throw new Error(file.size === 0 ? "That PDF is empty." : "PDFs must be smaller than 100 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(header) !== "%PDF-") {
    throw new Error("This file does not have a valid PDF signature.");
  }
}

export async function readPdfPageCount(bytes: Uint8Array): Promise<number> {
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

export function createPageItems(count: number): PageItem[] {
  return Array.from({ length: count }, (_, sourceIndex) => ({
    id: crypto.randomUUID(),
    sourceIndex,
    rotation: 0,
  }));
}

function parseHexColor(value: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) throw new Error("Choose a valid color.");
  return rgb(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

function toPdfPoint(
  viewport: pdfjs.PageViewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
  return { x: pdfX, y: pdfY };
}

async function applyAnnotation(
  annotation: Annotation,
  page: ReturnType<PDFDocument["getPages"]>[number],
  viewport: pdfjs.PageViewport,
  fontCache: Partial<Record<string, PDFFont>>,
  pdfDocument: PDFDocument,
): Promise<void> {
  const x = annotation.x * viewport.width;
  const y = annotation.y * viewport.height;
  const color = parseHexColor(annotation.color);

  if (annotation.type === "text") {
    const fontIndex = (annotation.bold ? 1 : 0) + (annotation.italic ? 2 : 0);
    const fontKey = `${annotation.font}:${fontIndex}`;
    const fontConstant = STANDARD_FONTS[annotation.font][fontIndex];
    let font = fontCache[fontKey];
    if (!font) {
      font = await pdfDocument.embedFont(fontConstant);
      fontCache[fontKey] = font;
    }
    const baseline = toPdfPoint(viewport, x, y + annotation.fontSize);
    page.drawText(annotation.text, {
      x: baseline.x,
      y: baseline.y,
      size: annotation.fontSize,
      font,
      color,
      ...(annotation.boxWidth !== undefined
        ? { maxWidth: annotation.boxWidth * viewport.width, lineHeight: annotation.fontSize * 1.2 }
        : {}),
    });
    return;
  }

  if (annotation.type === "highlight") {
    const left = x;
    const top = y;
    const right = x + annotation.width * viewport.width;
    const bottom = y + annotation.height * viewport.height;
    const points = [
      toPdfPoint(viewport, left, top),
      toPdfPoint(viewport, right, top),
      toPdfPoint(viewport, left, bottom),
      toPdfPoint(viewport, right, bottom),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    page.drawRectangle({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      color,
      opacity: annotation.opacity ?? 0.35,
    });
    return;
  }

  for (let index = 1; index < annotation.points.length; index += 1) {
    const from = annotation.points[index - 1];
    const to = annotation.points[index];
    page.drawLine({
      start: toPdfPoint(viewport, from.x * viewport.width, from.y * viewport.height),
      end: toPdfPoint(viewport, to.x * viewport.width, to.y * viewport.height),
      color,
      thickness: annotation.thickness,
      opacity: annotation.opacity ?? 0.88,
    });
  }
}

export async function exportPdf(
  sourceBytes: Uint8Array,
  pages: PageItem[],
  annotations: AnnotationMap,
  selectedPageIds?: Set<string>,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(sourceBytes.slice());
  const renderer = await pdfjs.getDocument({ data: sourceBytes.slice() }).promise;
  const output = await PDFDocument.create();
  const chosenPages = pages.filter((page) => !selectedPageIds || selectedPageIds.has(page.id));
  const sourceIndices = chosenPages.map((page) => page.sourceIndex);
  const copiedPages = await output.copyPages(source, sourceIndices);
  const fontCache: Partial<Record<string, PDFFont>> = {};

  try {
    for (let index = 0; index < copiedPages.length; index += 1) {
      const modelPage = chosenPages[index];

      const outputPage = output.addPage(copiedPages[index]);
      const pageProxy = await renderer.getPage(modelPage.sourceIndex + 1);
      const rotation = ((pageProxy.rotate + modelPage.rotation) % 360 + 360) % 360;
      outputPage.setRotation(degrees(rotation));
      const viewport = pageProxy.getViewport({ scale: 1, rotation });
      for (const annotation of annotations[modelPage.id] ?? []) {
        await applyAnnotation(annotation, outputPage, viewport, fontCache, output);
      }
    }
    return await output.save();
  } finally {
    await renderer.destroy();
  }
}

export async function mergePdfs(first: Uint8Array, second: Uint8Array): Promise<Uint8Array> {
  const firstPdf = await PDFDocument.load(first.slice());
  const secondPdf = await PDFDocument.load(second.slice());
  const merged = await PDFDocument.create();
  const firstPages = await merged.copyPages(firstPdf, firstPdf.getPageIndices());
  const secondPages = await merged.copyPages(secondPdf, secondPdf.getPageIndices());
  firstPages.forEach((page) => merged.addPage(page));
  secondPages.forEach((page) => merged.addPage(page));
  return merged.save();
}

export function fileStem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "document";
}

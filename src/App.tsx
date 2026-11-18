import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Copy,
  Download,
  FilePlus2,
  Files,
  FileText,
  Highlighter,
  Info,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
  PanelRight,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as pdfjs from "pdfjs-dist";
import { createPageItems, exportPdf, fileStem, mergePdfs, readPdfPageCount, validatePdfFile } from "./lib/pdf";
import { loadDraft, saveDraft } from "./lib/storage";
import type {
  Annotation,
  AnnotationMap,
  DraftSnapshot,
  FontName,
  PageItem,
  PenAnnotation,
  ToolMode,
} from "./types";

type RenderedSize = { width: number; height: number };
type Point = { x: number; y: number };
type HighlightHandle = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
type EditSnapshot = {
  pages: PageItem[];
  annotations: AnnotationMap;
  selectedPageId: string | null;
  selectedAnnotationId: string | null;
};

const EMPTY_ANNOTATIONS: AnnotationMap = {};
const HIGHLIGHT_COLORS = [
  { value: "#ffdb66", label: "Yellow" },
  { value: "#8fdda0", label: "Green" },
  { value: "#83caff", label: "Blue" },
  { value: "#f7a8c4", label: "Pink" },
  { value: "#ffc18a", label: "Orange" },
];

function nextRotation(rotation: number): number {
  return (rotation + 90) % 360;
}

function getPageLabel(index: number, total: number): string {
  return `Page ${index + 1} of ${total}`;
}

function cloneSnapshot(snapshot: EditSnapshot): EditSnapshot {
  return {
    pages: snapshot.pages.map((page) => ({ ...page })),
    annotations: Object.fromEntries(
      Object.entries(snapshot.annotations).map(([pageId, items]) => [
        pageId,
        items.map((item) => item.type === "pen"
          ? { ...item, points: item.points.map((point) => ({ ...point })) }
          : { ...item }),
      ]),
    ),
    selectedPageId: snapshot.selectedPageId,
    selectedAnnotationId: snapshot.selectedAnnotationId,
  };
}

function Viewer({
  bytes,
  page,
  annotations,
  zoom,
  tool,
  onPlaceAnnotation,
  onHighlightStart,
  onHighlightDrag,
  onSelectAnnotation,
  onHighlightResizeStart,
  onHighlightResize,
  onPenCommit,
  selectedAnnotationId,
  onRenderError,
}: {
  bytes: Uint8Array;
  page: PageItem;
  annotations: Annotation[];
  zoom: number;
  tool: ToolMode;
  onPlaceAnnotation: (point: Point) => void;
  onHighlightStart: (point: Point) => string;
  onHighlightDrag: (id: string, start: Point, end: Point) => void;
  onSelectAnnotation: (id: string) => void;
  onHighlightResizeStart: (id: string, point: Point, handle: HighlightHandle) => void;
  onHighlightResize: (id: string, point: Point) => void;
  onPenCommit: (points: Point[]) => void;
  selectedAnnotationId: string | null;
  onRenderError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [size, setSize] = useState<RenderedSize | null>(null);
  const [rendering, setRendering] = useState(true);
  const [penPreview, setPenPreview] = useState<Point[] | null>(null);
  const highlightDrag = useRef<{ id: string; start: Point } | null>(null);

  useEffect(() => {
    let active = true;
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    loadingTask.promise
      .then((loadedDocument) => {
        if (active) setDocument(loadedDocument);
        else void loadedDocument.destroy();
      })
      .catch((cause: unknown) => {
        if (active) onRenderError(cause instanceof Error ? cause.message : "The PDF could not be opened.");
      });
    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [bytes, onRenderError]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let active = true;
    let renderTask: pdfjs.RenderTask | null = null;
    setRendering(true);
    document
      .getPage(page.sourceIndex + 1)
      .then((pdfPage) => {
        if (!active || !canvasRef.current) return;
        const rotation = ((pdfPage.rotate + page.rotation) % 360 + 360) % 360;
        const viewport = pdfPage.getViewport({ scale: zoom, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not create a PDF canvas.");
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setSize({ width: viewport.width, height: viewport.height });
        renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderTask.promise;
      })
      .then(() => {
        if (active) setRendering(false);
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
          onRenderError(cause instanceof Error ? cause.message : "The PDF page could not be rendered.");
        }
      });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, page, zoom, onRenderError]);

  const getPoint = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (tool === "highlight") {
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = getPoint(event);
      const start = { x: Math.min(point.x, 0.98), y: Math.min(point.y, 0.965) };
      highlightDrag.current = { id: onHighlightStart(start), start };
      return;
    }
    if (tool !== "draw") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPenPreview([getPoint(event)]);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (highlightDrag.current) {
      onHighlightDrag(highlightDrag.current.id, highlightDrag.current.start, getPoint(event));
      return;
    }
    if (!penPreview) return;
    setPenPreview((current) => (current ? [...current, getPoint(event)] : null));
  };

  const handlePointerUp = () => {
    if (highlightDrag.current) {
      highlightDrag.current = null;
      return;
    }
    if (penPreview && penPreview.length > 1) onPenCommit(penPreview);
    setPenPreview(null);
  };

  const penAnnotations = annotations.filter((annotation) => annotation.type === "pen");
  const overlayStyle = size ? { width: size.width, height: size.height } : undefined;

  return (
    <div className="viewer-shell">
      {rendering && (
        <div className="rendering-indicator">
          <LoaderCircle size={16} className="spin" /> Rendering page…
        </div>
      )}
      <div className="paper-shadow" style={overlayStyle}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        {size && (
          <div
            className={`annotation-layer tool-${tool}`}
            style={overlayStyle}
            onClick={(event) => {
              if (tool !== "text") return;
              const rect = event.currentTarget.getBoundingClientRect();
              onPlaceAnnotation({
                x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
              });
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {annotations.map((annotation) => {
              if (annotation.type === "pen") return null;
              const isSelected = selectedAnnotationId === annotation.id;
              if (annotation.type === "text") {
                const fontFamily = {
                  Helvetica: "Arial, Helvetica, sans-serif",
                  TimesRoman: '"Times New Roman", Times, serif',
                  Courier: '"Courier New", Courier, monospace',
                }[annotation.font];
                return (
                  <div
                    key={annotation.id}
                    className={`text-annotation${isSelected ? " selected" : ""}`}
                    style={{
                      left: `${annotation.x * 100}%`,
                      top: `${annotation.y * 100}%`,
                      fontSize: `${annotation.fontSize * zoom}px`,
                      color: annotation.color,
                      fontFamily,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAnnotation(annotation.id);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {annotation.text || "Text"}
                  </div>
                );
              }
              return (
                <div
                  key={annotation.id}
                  className={`highlight-annotation${isSelected ? " selected" : ""}`}
                  style={{
                    left: `${annotation.x * 100}%`,
                    top: `${annotation.y * 100}%`,
                    width: `${annotation.width * 100}%`,
                    height: `${annotation.height * 100}%`,
                    backgroundColor: annotation.color,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectAnnotation(annotation.id);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {isSelected && (
                    <>
                      {(["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map((position) => (
                        <ResizeHandle
                          key={position}
                          position={position}
                          width={annotation.width}
                          height={annotation.height}
                          onResizeStart={(point) => onHighlightResizeStart(annotation.id, point, position)}
                          onResize={(point) => onHighlightResize(annotation.id, point)}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
            <svg className="pen-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {penAnnotations.map((annotation) => (
                <polyline
                  key={annotation.id}
                  points={annotation.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")}
                  fill="none"
                  stroke={annotation.color}
                  strokeWidth={size ? (annotation.thickness / size.width) * 1000 : 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {penPreview && (
                <polyline
                  points={penPreview.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")}
                  fill="none"
                  stroke="#315ee8"
                  strokeWidth={size ? (2.4 / size.width) * 1000 : 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function ResizeHandle({
  position,
  width,
  height,
  onResizeStart,
  onResize,
}: {
  position: HighlightHandle;
  width: number;
  height: number;
  onResizeStart: (point: Point) => void;
  onResize: (point: Point) => void;
}) {
  return (
    <span
      className={`highlight-resize-handle handle-${position}`}
      role="slider"
      tabIndex={0}
      aria-label={`Resize highlight ${position}`}
      aria-valuemin={1}
      aria-valuemax={100}
      aria-valuenow={Math.round((position.includes("left") || position.includes("right") ? width : height) * 100)}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const layer = event.currentTarget.closest(".annotation-layer");
        if (!layer) return;
        const rect = layer.getBoundingClientRect();
        onResizeStart({
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        });
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const layer = event.currentTarget.closest(".annotation-layer");
        if (!layer) return;
        const rect = layer.getBoundingClientRect();
        onResize({
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        });
      }}
    />
  );
}

function PageThumbnail({
  page,
  document,
  isActive,
  index,
  total,
  onClick,
}: {
  page: PageItem;
  document: pdfjs.PDFDocumentProxy | null;
  isActive: boolean;
  index: number;
  total: number;
  onClick: () => void;
}) {
  const thumbnailCanvas = useRef<HTMLCanvasElement>(null);
  const [thumbnailError, setThumbnailError] = useState(false);

  useEffect(() => {
    const canvas = thumbnailCanvas.current;
    if (!document || !canvas) return;
    let active = true;
    let renderTask: pdfjs.RenderTask | null = null;
    const render = async () => {
      try {
        const pdfPage = await document.getPage(page.sourceIndex + 1);
        if (!active) return;
        const rotation = ((pdfPage.rotate + page.rotation) % 360 + 360) % 360;
        const viewport = pdfPage.getViewport({ scale: 0.2, rotation });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not create a thumbnail canvas.");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = pdfPage.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (cause) {
        if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
          setThumbnailError(true);
        }
      }
    };

    if (typeof IntersectionObserver === "undefined") {
      void render();
    } else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void render();
        }
      }, { root: canvas.closest(".page-list"), rootMargin: "100px" });
      observer.observe(canvas);
    }
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, page.rotation, page.sourceIndex]);

  return (
    <button className={`page-card${isActive ? " active" : ""}`} onClick={onClick} aria-current={isActive ? "page" : undefined}>
      <span className="thumbnail-frame">
        <canvas ref={thumbnailCanvas} />
        {thumbnailError && <FileText size={28} className="thumbnail-fallback" />}
      </span>
      <span className="page-card-label">
        <span>Page {index + 1}</span>
        <span className="page-card-count">{total} pages</span>
      </span>
    </button>
  );
}

export default function App() {
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<PageItem[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationMap>(EMPTY_ANNOTATIONS);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>("select");
  const [zoom, setZoom] = useState(0.9);
  const [localSaveState, setLocalSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [rightPanel, setRightPanel] = useState<"properties" | "tools">("properties");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [thumbnailDocument, setThumbnailDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const historyRef = useRef<EditSnapshot[]>([]);
  const redoHistoryRef = useRef<EditSnapshot[]>([]);
  const editorStateRef = useRef<EditSnapshot>({
    pages,
    annotations,
    selectedPageId,
    selectedAnnotationId,
  });
  const highlightResizeRef = useRef<{
    id: string;
    handle: HighlightHandle;
    point: Point;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  editorStateRef.current = { pages, annotations, selectedPageId, selectedAnnotationId };

  const recordUndo = () => {
    const snapshot = cloneSnapshot(editorStateRef.current);
    historyRef.current = [
      ...historyRef.current.slice(-49),
      snapshot,
    ];
    redoHistoryRef.current = [];
    setUndoCount(historyRef.current.length);
    setRedoCount(0);
  };

  const clearUndoHistory = () => {
    historyRef.current = [];
    redoHistoryRef.current = [];
    setUndoCount(0);
    setRedoCount(0);
  };

  const undoEdit = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoHistoryRef.current = [...redoHistoryRef.current, cloneSnapshot(editorStateRef.current)];
    setPages(previous.pages);
    setAnnotations(previous.annotations);
    editorStateRef.current = previous;
    setUndoCount(historyRef.current.length);
    setRedoCount(redoHistoryRef.current.length);
    setSelectedPageId(previous.selectedPageId && previous.pages.some((page) => page.id === previous.selectedPageId)
      ? previous.selectedPageId
      : previous.pages[0]?.id ?? null);
    setSelectedAnnotationId(previous.selectedAnnotationId);
  }, []);

  const redoEdit = useCallback(() => {
    const next = redoHistoryRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, cloneSnapshot(editorStateRef.current)].slice(-50);
    setPages(next.pages);
    setAnnotations(next.annotations);
    editorStateRef.current = next;
    setUndoCount(historyRef.current.length);
    setRedoCount(redoHistoryRef.current.length);
    setSelectedPageId(next.selectedPageId && next.pages.some((page) => page.id === next.selectedPageId)
      ? next.selectedPageId
      : next.pages[0]?.id ?? null);
    setSelectedAnnotationId(next.selectedAnnotationId);
  }, []);

  const currentPageIndex = pages.findIndex((page) => page.id === selectedPageId);
  const currentPage = currentPageIndex >= 0 ? pages[currentPageIndex] : null;
  const currentAnnotations = currentPage ? annotations[currentPage.id] ?? [] : [];
  const selectedAnnotation = currentAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  const reportRenderError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey && historyRef.current.length > 0) {
        event.preventDefault();
        undoEdit();
      } else if ((event.ctrlKey || event.metaKey) && key === "y" && redoHistoryRef.current.length > 0) {
        event.preventDefault();
        redoEdit();
      } else if (key === "delete" && selectedAnnotation?.type === "highlight" && currentPage) {
        event.preventDefault();
        recordUndo();
        setAnnotations((existing) => ({
          ...existing,
          [currentPage.id]: (existing[currentPage.id] ?? []).filter((item) => item.id !== selectedAnnotation.id),
        }));
        setSelectedAnnotationId(null);
      }
    };
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [undoEdit, redoEdit, selectedAnnotation, currentPage]);

  useEffect(() => {
    let active = true;
    loadDraft()
      .then((draft) => {
        if (!active) return;
        if (draft) {
          setSourceBytes(draft.sourceBytes);
          setFileName(draft.fileName);
          setPages(draft.pages);
          setAnnotations(draft.annotations);
          editorStateRef.current = {
            pages: draft.pages,
            annotations: draft.annotations,
            selectedPageId: draft.pages[0]?.id ?? null,
            selectedAnnotationId: null,
          };
          clearUndoHistory();
          setSelectedPageId(draft.pages[0]?.id ?? null);
          setLocalSaveState("saved");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(`Local draft storage is unavailable: ${cause instanceof Error ? cause.message : "unknown error"}`);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sourceBytes || !ready) return;
    setLocalSaveState("saving");
    const timer = window.setTimeout(() => {
      const snapshot: DraftSnapshot = {
        fileName,
        sourceBytes,
        pages,
        annotations,
        savedAt: Date.now(),
      };
      saveDraft(snapshot)
        .then(() => setLocalSaveState("saved"))
        .catch((cause: unknown) => {
          setLocalSaveState("error");
          setError(`Could not save your local draft: ${cause instanceof Error ? cause.message : "unknown error"}`);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [sourceBytes, fileName, pages, annotations, ready]);

  useEffect(() => {
    if (!sourceBytes) {
      setThumbnailDocument(null);
      return;
    }
    let active = true;
    const task = pdfjs.getDocument({ data: sourceBytes.slice() });
    task.promise
      .then((document) => {
        if (active) setThumbnailDocument(document);
        else void document.destroy();
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load page thumbnails.");
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [sourceBytes]);

  const openFile = useCallback(async (file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    try {
      await validatePdfFile(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const count = await readPdfPageCount(bytes);
      if (count < 1) throw new Error("This PDF has no pages.");
      const nextPages = createPageItems(count);
      setSourceBytes(bytes);
      setFileName(file.name);
      setPages(nextPages);
      setAnnotations({});
      editorStateRef.current = {
        pages: nextPages,
        annotations: {},
        selectedPageId: nextPages[0]?.id ?? null,
        selectedAnnotationId: null,
      };
      clearUndoHistory();
      setSelectedPageId(nextPages[0].id);
      setSelectedAnnotationId(null);
      setTool("select");
      setNotice("PDF opened. Your edits stay on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open this PDF.");
    } finally {
      if (openInputRef.current) openInputRef.current.value = "";
    }
  }, []);

  const onOpenInput = (event: ChangeEvent<HTMLInputElement>) => void openFile(event.target.files?.[0]);

  const mergeFile = useCallback(async (file?: File) => {
    if (!file || !sourceBytes) return;
    setError("");
    setNotice("");
    try {
      await validatePdfFile(file);
      const extraBytes = new Uint8Array(await file.arrayBuffer());
      const editedCurrent = await exportPdf(sourceBytes, pages, annotations);
      const mergedBytes = await mergePdfs(editedCurrent, extraBytes);
      const count = await readPdfPageCount(mergedBytes);
      const nextPages = createPageItems(count);
      setSourceBytes(mergedBytes);
      setPages(nextPages);
      setAnnotations({});
      editorStateRef.current = {
        pages: nextPages,
        annotations: {},
        selectedPageId: nextPages[0]?.id ?? null,
        selectedAnnotationId: null,
      };
      clearUndoHistory();
      setFileName(`${fileStem(fileName)}-merged.pdf`);
      setSelectedPageId(nextPages[0]?.id ?? null);
      setSelectedAnnotationId(null);
      setNotice(`${file.name} was added to the end of this document.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not merge this PDF.");
    } finally {
      if (mergeInputRef.current) mergeInputRef.current.value = "";
    }
  }, [annotations, fileName, pages, sourceBytes]);

  const onMergeInput = (event: ChangeEvent<HTMLInputElement>) => void mergeFile(event.target.files?.[0]);

  const downloadPdf = useCallback(async (currentPageOnly = false) => {
    if (!sourceBytes || !currentPage) return;
    setError("");
    try {
      const selected = currentPageOnly ? new Set([currentPage.id]) : undefined;
      const bytes = await exportPdf(sourceBytes, pages, annotations, selected);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = currentPageOnly
        ? `${fileStem(fileName)}-page-${currentPageIndex + 1}.pdf`
        : `${fileStem(fileName)}-edited.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(currentPageOnly ? "Current page downloaded as a PDF." : "Edited PDF downloaded to your device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this PDF.");
    }
  }, [annotations, currentPage, currentPageIndex, fileName, pages, sourceBytes]);

  const updateCurrentAnnotations = (update: (existing: Annotation[]) => Annotation[]) => {
    if (!currentPage) return;
    setAnnotations((existing) => ({
      ...existing,
      [currentPage.id]: update(existing[currentPage.id] ?? []),
    }));
  };

  const addAnnotation = (point: Point) => {
    if (!currentPage || tool !== "text") return;
    recordUndo();
    if (tool === "text") {
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        type: "text",
        x: point.x,
        y: point.y,
        text: "Your text",
        font: "Helvetica",
        fontSize: 16,
        color: "#20242b",
      };
      updateCurrentAnnotations((existing) => [...existing, annotation]);
      setSelectedAnnotationId(annotation.id);
      return;
    }
  };

  const startHighlight = (point: Point): string => {
    if (!currentPage) return "";
    recordUndo();
    const x = Math.min(point.x, 0.98);
    const y = Math.min(point.y, 0.965);
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      type: "highlight",
      x,
      y,
      width: Math.min(0.22, 1 - x),
      height: Math.min(0.035, 1 - y),
      color: "#ffdb66",
    };
    updateCurrentAnnotations((existing) => [...existing, annotation]);
    setSelectedAnnotationId(annotation.id);
    return annotation.id;
  };

  const dragHighlight = (id: string, start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const draggedHorizontally = Math.abs(dx) >= 0.005;
    const draggedVertically = Math.abs(dy) >= 0.012;
    updateAnnotation(id, {
      ...(draggedHorizontally
        ? {
          x: Math.min(start.x, end.x),
          width: Math.min(1 - Math.min(start.x, end.x), Math.max(0.02, Math.abs(dx))),
        }
        : {}),
      ...(draggedVertically
        ? {
          y: Math.min(start.y, end.y),
          height: Math.min(1 - Math.min(start.y, end.y), Math.max(0.015, Math.abs(dy))),
        }
        : {}),
    }, false);
  };

  const startHighlightResize = (id: string, point: Point, handle: HighlightHandle) => {
    const highlight = currentAnnotations.find(
      (annotation) => annotation.id === id && annotation.type === "highlight",
    );
    if (!highlight || highlight.type !== "highlight") return;
    recordUndo();
    highlightResizeRef.current = {
      id,
      handle,
      point,
      x: highlight.x,
      y: highlight.y,
      width: highlight.width,
      height: highlight.height,
    };
  };

  const resizeHighlight = (id: string, point: Point) => {
    const initial = highlightResizeRef.current;
    if (!initial || initial.id !== id) return;
    const minWidth = 0.008;
    const minHeight = 0.008;
    let { x, y, width, height } = initial;
    const dx = point.x - initial.point.x;
    const dy = point.y - initial.point.y;
    const movesLeft = initial.handle.includes("left");
    const movesRight = initial.handle.includes("right");
    const movesTop = initial.handle.includes("top");
    const movesBottom = initial.handle.includes("bottom");

    if (movesLeft) {
      x = Math.max(0, Math.min(initial.x + initial.width - minWidth, initial.x + dx));
      width = initial.x + initial.width - x;
    } else if (movesRight) {
      width = Math.max(minWidth, Math.min(1 - initial.x, initial.width + dx));
    }

    if (movesTop) {
      y = Math.max(0, Math.min(initial.y + initial.height - minHeight, initial.y + dy));
      height = initial.y + initial.height - y;
    } else if (movesBottom) {
      height = Math.max(minHeight, Math.min(1 - initial.y, initial.height + dy));
    }

    updateAnnotation(id, { x, y, width, height }, false);
  };

  const addPenAnnotation = (points: Point[]) => {
    recordUndo();
    const annotation: PenAnnotation = {
      id: crypto.randomUUID(),
      type: "pen",
      x: 0,
      y: 0,
      points,
      color: "#315ee8",
      thickness: 2.4,
    };
    updateCurrentAnnotations((existing) => [...existing, annotation]);
    setSelectedAnnotationId(annotation.id);
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>, saveUndo = true) => {
    if (saveUndo) recordUndo();
    updateCurrentAnnotations((existing) => existing.map((item) => item.id === id ? { ...item, ...patch } as Annotation : item));
  };

  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotationId) return;
    recordUndo();
    updateCurrentAnnotations((existing) => existing.filter((item) => item.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
  };

  const movePage = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= pages.length) return;
    recordUndo();
    setPages((existing) => {
      const reordered = [...existing];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };

  const rotatePage = () => {
    if (!currentPage) return;
    recordUndo();
    setPages((existing) => existing.map((page) =>
      page.id === currentPage.id ? { ...page, rotation: nextRotation(page.rotation) } : page,
    ));
  };

  const duplicatePage = () => {
    if (!currentPage) return;
    recordUndo();
    const duplicate = { ...currentPage, id: crypto.randomUUID() };
    const sourceAnnotations = annotations[currentPage.id] ?? [];
    const copiedAnnotations = sourceAnnotations.map((annotation) => ({ ...annotation, id: crypto.randomUUID() })) as Annotation[];
    setPages((existing) => [
      ...existing.slice(0, currentPageIndex + 1),
      duplicate,
      ...existing.slice(currentPageIndex + 1),
    ]);
    setAnnotations((existing) => ({ ...existing, [duplicate.id]: copiedAnnotations }));
    setSelectedPageId(duplicate.id);
    setSelectedAnnotationId(null);
  };

  const deletePage = () => {
    if (!currentPage || pages.length <= 1) return;
    recordUndo();
    const nextPages = pages.filter((page) => page.id !== currentPage.id);
    const nextIndex = Math.min(currentPageIndex, nextPages.length - 1);
    setPages(nextPages);
    setAnnotations((existing) => {
      const next = { ...existing };
      delete next[currentPage.id];
      return next;
    });
    setSelectedPageId(nextPages[nextIndex].id);
    setSelectedAnnotationId(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  const annotationFont = selectedAnnotation?.type === "text" ? selectedAnnotation.font : "Helvetica";

  const localSaveLabel = useMemo(() => {
    if (localSaveState === "saving") return "Saving on this device…";
    if (localSaveState === "saved") return "Saved on this device";
    if (localSaveState === "error") return "Local save failed";
    return "Local-only workspace";
  }, [localSaveState]);

  return (
    <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark"><FileText size={18} strokeWidth={2.2} /></div>
          <span className="brand-name">paperplane</span>
          <span className="brand-divider" />
          {sourceBytes ? (
            <div className="document-title">
              <span className="pdf-file-icon">PDF</span>
              <span className="document-title-text" title={fileName}>{fileName}</span>
              <span className="local-badge"><CloudOff size={12} /> Local</span>
            </div>
          ) : <span className="product-label">PDF studio</span>}
        </div>
        <div className="topbar-actions">
          <span className={`save-status save-${localSaveState}`}>
            {localSaveState === "saving" ? <LoaderCircle size={14} className="spin" /> :
              localSaveState === "saved" ? <Check size={14} /> : <ShieldCheck size={14} />}
            {localSaveLabel}
          </span>
          <button
            className="button button-outline undo-button"
            disabled={undoCount === 0}
            title="Undo last edit (Ctrl+Z)"
            aria-label="Undo last edit"
            onClick={undoEdit}
          >
            <Undo2 size={15} /> <span>Undo</span><kbd>Ctrl Z</kbd>
          </button>
          <button
            className="button button-outline redo-button"
            disabled={redoCount === 0}
            title="Redo last undone edit (Ctrl+Y)"
            aria-label="Redo last undone edit"
            onClick={redoEdit}
          >
            <Redo2 size={15} /> <span>Redo</span><kbd>Ctrl Y</kbd>
          </button>
          <button className="button button-outline button-open" onClick={() => openInputRef.current?.click()}>
            <Upload size={15} /> Open PDF
          </button>
          <button className="button button-primary" disabled={!sourceBytes} onClick={() => void downloadPdf()}>
            <Download size={15} /> Export PDF
          </button>
        </div>
      </header>

      <main className="workspace">
        {!sourceBytes ? (
          <section className="welcome-screen">
            <div className="welcome-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE BY DESIGN</div>
              <h1>Your PDFs.<br /><span>Your space.</span></h1>
              <p>A calm, capable PDF workspace that stays right here on your device. No uploads, accounts, or cloud storage.</p>
              <button className="button button-primary welcome-open" onClick={() => openInputRef.current?.click()}>
                <FilePlus2 size={17} /> Open a PDF <ArrowRight size={16} />
              </button>
              <div className="welcome-footnote"><ShieldCheck size={15} /> Files stay on this device, always.</div>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="art-glow" />
              <div className="art-page page-back"><div /><div /><div /></div>
              <div className="art-page page-front">
                <div className="art-page-head"><span className="art-icon"><FileText size={19} /></span><span className="art-tag">PDF</span></div>
                <div className="art-title-line" /><div className="art-copy-line wide" /><div className="art-copy-line" />
                <div className="art-highlight" /><div className="art-copy-line wide" /><div className="art-copy-line short" />
                <div className="art-chart"><span /><span /><span /><span /><span /></div>
              </div>
              <div className="art-float float-privacy"><ShieldCheck size={16} /><span>Private by design</span></div>
              <div className="art-float float-edit"><PenLine size={15} /><span>Made for markup</span></div>
            </div>
            <div className="welcome-bottom">
              <span><Type size={15} /> Add text & mark up</span><i />
              <span><Files size={15} /> Organize pages</span><i />
              <span><Download size={15} /> Export locally</span>
            </div>
          </section>
        ) : (
          <div className="editor-layout">
            <aside className="page-sidebar">
              <div className="sidebar-heading">
                <div><span className="sidebar-eyebrow">DOCUMENT</span><h2>Pages <span>{pages.length}</span></h2></div>
                <button className="icon-button subtle" aria-label="Merge another PDF" title="Merge another PDF" onClick={() => mergeInputRef.current?.click()}><Plus size={17} /></button>
              </div>
              <button className="merge-button" onClick={() => mergeInputRef.current?.click()}>
                <Files size={15} /><span>Merge another PDF</span><Plus size={15} />
              </button>
              <div className="page-list">
                {pages.map((page, index) => (
                  <PageThumbnail
                    key={page.id}
                    page={page}
                    document={thumbnailDocument}
                    isActive={page.id === selectedPageId}
                    index={index}
                    total={pages.length}
                    onClick={() => { setSelectedPageId(page.id); setSelectedAnnotationId(null); }}
                  />
                ))}
              </div>
              <div className="sidebar-footer">
                <div className="privacy-note"><ShieldCheck size={15} /><span><b>Private by design</b><small>Your PDF stays on this device.</small></span></div>
              </div>
            </aside>

            <section className="document-area">
              <div className="document-toolbar">
                <div className="tool-group">
                  <button className={`tool-button${tool === "select" ? " active" : ""}`} onClick={() => setTool("select")} title="Select">
                    <MousePointer2 size={16} /><span>Select</span>
                  </button>
                  <span className="toolbar-separator" />
                  <button className={`tool-button${tool === "text" ? " active" : ""}`} onClick={() => setTool("text")} title="Add text">
                    <Type size={16} /><span>Text</span>
                  </button>
                  <button className={`tool-button${tool === "highlight" ? " active" : ""}`} onClick={() => setTool("highlight")} title="Highlight">
                    <Highlighter size={16} /><span>Highlight</span>
                  </button>
                  <button className={`tool-button${tool === "draw" ? " active" : ""}`} onClick={() => setTool("draw")} title="Draw">
                    <PenLine size={16} /><span>Draw</span>
                  </button>
                </div>
                <div className="toolbar-right">
                  <button className="icon-button mobile-inspector-toggle" onClick={() => setInspectorOpen(true)} aria-label="Open edit panel" title="Open edit panel"><PanelRight size={16} /></button>
                  <span className="page-indicator">
                    <button className="icon-button mini" disabled={currentPageIndex <= 0} onClick={() => setSelectedPageId(pages[currentPageIndex - 1]?.id ?? null)} aria-label="Previous page"><ChevronLeft size={16} /></button>
                    <b>{currentPageIndex + 1}</b><span>/</span>{pages.length}
                    <button className="icon-button mini" disabled={currentPageIndex >= pages.length - 1} onClick={() => setSelectedPageId(pages[currentPageIndex + 1]?.id ?? null)} aria-label="Next page"><ChevronRight size={16} /></button>
                  </span>
                  <span className="toolbar-separator" />
                  <button className="icon-button mini" onClick={() => setZoom((value) => Math.max(0.4, Math.round((value - 0.1) * 100) / 100))} aria-label="Zoom out"><ZoomOut size={16} /></button>
                  <span className="zoom-label">{Math.round(zoom * 100)}%</span>
                  <button className="icon-button mini" onClick={() => setZoom((value) => Math.min(1.6, Math.round((value + 0.1) * 100) / 100))} aria-label="Zoom in"><ZoomIn size={16} /></button>
                </div>
              </div>

              {error && <div className="alert alert-error"><Info size={15} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
              {notice && !error && <div className="alert alert-success"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}

              {currentPage ? (
                <div className="page-stage">
                  <div className="stage-scroll">
                    <div className="stage-content">
                      <div className="stage-page-caption">
                        <span>{getPageLabel(currentPageIndex, pages.length)}</span>
                        {tool !== "select" && <span className="mode-hint">
                          {tool === "text" ? "Click the page to place text" : tool === "highlight" ? "Click and drag to size a highlight" : "Draw on the page"}
                        </span>}
                      </div>
                      <Viewer
                        key={`${currentPage.id}-${currentPage.rotation}`}
                        bytes={sourceBytes}
                        page={currentPage}
                        annotations={currentAnnotations}
                        zoom={zoom}
                        tool={tool}
                        onPlaceAnnotation={addAnnotation}
                        onHighlightStart={startHighlight}
                        onHighlightDrag={dragHighlight}
                        onSelectAnnotation={setSelectedAnnotationId}
                        onHighlightResizeStart={startHighlightResize}
                        onHighlightResize={resizeHighlight}
                        onPenCommit={addPenAnnotation}
                        selectedAnnotationId={selectedAnnotationId}
                        onRenderError={reportRenderError}
                      />
                    </div>
                  </div>
                  <div className="stage-bottom">
                    <span><span className="status-dot" /> Autosaved locally</span>
                    <span className="stage-bottom-divider" />
                    <span>{fileName}</span>
                  </div>
                </div>
              ) : (
                <div className="empty-pages"><FileText size={28} /><p>No page selected</p></div>
              )}
            </section>

            <aside className={`inspector${inspectorOpen ? " open" : ""}`}>
              <div className="inspector-tabs">
                <button className={rightPanel === "properties" ? "active" : ""} onClick={() => setRightPanel("properties")}>Edit</button>
                <button className={rightPanel === "tools" ? "active" : ""} onClick={() => setRightPanel("tools")}>More tools <span className="soon-dot" /></button>
                <button className="icon-button inspector-mobile-close" onClick={() => setInspectorOpen(false)} aria-label="Close edit panel"><X size={15} /></button>
              </div>
              {rightPanel === "properties" ? (
                <div className="inspector-content">
                  <div className="inspector-title"><h2>{selectedAnnotation ? "Edit markup" : "Page tools"}</h2><p>{selectedAnnotation ? "Adjust your selected annotation." : "Organize and export your pages."}</p></div>
                  {selectedAnnotation?.type === "text" ? (
                    <div className="property-section">
                      <label className="field-label" htmlFor="text-content">Text</label>
                      <textarea id="text-content" className="text-input" value={selectedAnnotation.text} onChange={(event) => updateAnnotation(selectedAnnotation.id, { text: event.target.value })} rows={3} />
                      <label className="field-label" htmlFor="font-family">Font family</label>
                      <div className="select-wrap"><select id="font-family" value={annotationFont} onChange={(event) => updateAnnotation(selectedAnnotation.id, { font: event.target.value as FontName })}>
                        <option value="Helvetica">Helvetica</option><option value="TimesRoman">Times New Roman</option><option value="Courier">Courier</option>
                      </select><ChevronDown size={14} /></div>
                      <div className="field-row"><label className="field-label" htmlFor="font-size">Size</label><span className="field-value">{selectedAnnotation.fontSize} pt</span></div>
                      <input id="font-size" type="range" min="8" max="48" step="1" value={selectedAnnotation.fontSize} onChange={(event) => updateAnnotation(selectedAnnotation.id, { fontSize: Number(event.target.value) })} />
                      <ColorPicker value={selectedAnnotation.color} onChange={(color) => updateAnnotation(selectedAnnotation.id, { color })} />
                      <button className="delete-markup" onClick={deleteSelectedAnnotation}><Trash2 size={15} /> Remove text</button>
                    </div>
                  ) : selectedAnnotation?.type === "highlight" ? (
                    <div className="property-section">
                      <p className="selected-markup-info"><Highlighter size={16} /> Highlight</p>
                      <p className="resize-hint">Click and drag on the page, or drag any edge or corner handle to resize.</p>
                      <ColorPicker value={selectedAnnotation.color} onChange={(color) => updateAnnotation(selectedAnnotation.id, { color })} />
                      <button className="delete-markup" title="Delete selected highlight (Delete)" onClick={deleteSelectedAnnotation}><Trash2 size={15} /> Delete highlight <kbd>Delete</kbd></button>
                    </div>
                  ) : selectedAnnotation?.type === "pen" ? (
                    <div className="property-section">
                      <p className="selected-markup-info"><PenLine size={16} /> Freehand drawing</p>
                      <ColorPicker value={selectedAnnotation.color} onChange={(color) => updateAnnotation(selectedAnnotation.id, { color })} />
                      <button className="delete-markup" onClick={deleteSelectedAnnotation}><Trash2 size={15} /> Remove drawing</button>
                    </div>
                  ) : (
                    <>
                      <div className="property-section">
                        <div className="section-label">PAGE ARRANGEMENT</div>
                        <button className="action-row" disabled={currentPageIndex <= 0} onClick={() => movePage(currentPageIndex, -1)}><ArrowUp size={16} /><span>Move page up</span><span className="shortcut"><ArrowUp size={12} /></span></button>
                        <button className="action-row" disabled={currentPageIndex >= pages.length - 1} onClick={() => movePage(currentPageIndex, 1)}><ArrowDown size={16} /><span>Move page down</span><span className="shortcut"><ArrowDown size={12} /></span></button>
                        <button className="action-row" onClick={rotatePage}><RotateCw size={16} /><span>Rotate page</span><span className="action-trailing">{currentPage?.rotation ?? 0}°</span></button>
                        <button className="action-row" disabled={pages.length >= 1000} onClick={duplicatePage}><Copy size={16} /><span>Duplicate page</span></button>
                        <button className="action-row danger-row" disabled={pages.length <= 1} onClick={deletePage}><Trash2 size={16} /><span>Delete page</span></button>
                      </div>
                      <div className="property-divider" />
                      <div className="property-section">
                        <div className="section-label">EXPORT</div>
                        <button className="action-row" onClick={() => void downloadPdf(true)}><Download size={16} /><span>Download this page</span><MoveUpRight size={14} className="action-trailing" /></button>
                      </div>
                      <div className="font-note"><Info size={15} /><p>Text you add uses the font options above. Existing PDF text stays as originally embedded.</p></div>
                    </>
                  )}
                  <div className="inspector-bottom-note"><CloudOff size={14} /><span>Everything runs locally</span></div>
                </div>
              ) : (
                <div className="inspector-content tools-panel">
                  <div className="inspector-title"><h2>PDF toolkit</h2><p>Every tool is designed to work on-device.</p></div>
                  <div className="toolkit-group-title">READY TO USE</div>
                  <button className="toolkit-card" onClick={() => mergeInputRef.current?.click()}><span className="toolkit-icon blue"><Files size={17} /></span><span><b>Merge PDFs</b><small>Add another PDF to this file</small></span><ChevronRight size={15} /></button>
                  <button className="toolkit-card" onClick={() => void downloadPdf(true)}><span className="toolkit-icon green"><Download size={17} /></span><span><b>Extract a page</b><small>Export the current page alone</small></span><ChevronRight size={15} /></button>
                  <div className="toolkit-group-title coming-title">ON THE ROADMAP <span>COMING SOON</span></div>
                  {[
                    ["Compress PDF", "Reduce file size"],
                    ["Split by page range", "Create smaller PDFs"],
                    ["Watermark", "Stamp text across pages"],
                    ["Fill & sign", "Forms and signature tools"],
                    ["Convert & OCR", "Image and text conversion"],
                  ].map(([title, description]) => (
                    <div className="toolkit-card disabled-tool" key={title}>
                      <span className="toolkit-icon muted"><FileText size={16} /></span>
                      <span><b>{title}</b><small>{description}</small></span>
                      <span className="soon-label">Soon</span>
                    </div>
                  ))}
                  <div className="roadmap-note"><CircleHelp size={15} /><span>Not available yet — no buttons here pretend otherwise.</span></div>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>

      <input ref={openInputRef} className="visually-hidden" type="file" accept=".pdf,application/pdf" onChange={onOpenInput} />
      <input ref={mergeInputRef} className="visually-hidden" type="file" accept=".pdf,application/pdf" onChange={onMergeInput} />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="color-field">
      <label className="field-label">Color</label>
      <div className="color-options">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            className={`color-swatch${value.toLowerCase() === color.value ? " active" : ""}`}
            style={{ backgroundColor: color.value }}
            aria-label={`${color.label} highlight color`}
            aria-pressed={value.toLowerCase() === color.value}
            title={color.label}
            onClick={() => onChange(color.value)}
          />
        ))}
        <label className="custom-color-control" title="Choose a custom color" style={{ backgroundColor: value }}>
          <input type="color" aria-label="Choose custom highlight color" value={value} onChange={(event) => onChange(event.target.value)} />
          <span><Plus size={13} /></span>
        </label>
      </div>
    </div>
  );
}

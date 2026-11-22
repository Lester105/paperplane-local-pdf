import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bold,
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
  Italic,
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
  useRef,
  useState,
} from "react";
import * as pdfjs from "pdfjs-dist";
import { createPageItems, exportPdf, fileStem, mergePdfs, readPdfPageCount, validatePdfFile } from "./lib/pdf";
import {
  moveAnnotation,
  isAnnotationDrag,
  constrainTextDragDelta,
  resizeHighlightAnnotation,
  resizeTextAnnotation,
  type HighlightResizeHandle,
} from "./lib/annotations";
import { findMostVisiblePage } from "./lib/page-visibility";
import type {
  Annotation,
  AnnotationMap,
  FontName,
  PageItem,
  PenAnnotation,
  TextAnnotation,
  ToolMode,
} from "./types";

type RenderedSize = { width: number; height: number };
type ResizeBounds = { width: number; height: number };
type Point = { x: number; y: number };
type HighlightHandle = HighlightResizeHandle;
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
  document,
  page,
  annotations,
  zoom,
  tool,
  onPlaceAnnotation,
  onHighlightStart,
  onHighlightDrag,
  onHighlightEnd,
  onSelectAnnotation,
  editingTextId,
  onStartTextEditing,
  onTextChange,
  onFinishTextEditing,
  onAnnotationDragStart,
  onAnnotationDrag,
  movingTextId,
  onHighlightResizeStart,
  onHighlightResize,
  onHighlightResizeEnd,
  onTextResizeStart,
  onTextResize,
  onTextResizeEnd,
  onPenCommit,
  selectedAnnotationId,
  onRenderError,
}: {
  document: pdfjs.PDFDocumentProxy | null;
  page: PageItem;
  annotations: Annotation[];
  zoom: number;
  tool: ToolMode;
  onPlaceAnnotation: (point: Point) => void;
  onHighlightStart: (point: Point) => string;
  onHighlightDrag: (id: string, start: Point, end: Point) => void;
  onHighlightEnd: () => void;
  onSelectAnnotation: (id: string) => void;
  editingTextId: string | null;
  onStartTextEditing: (id: string) => void;
  onTextChange: (id: string, text: string) => void;
  onFinishTextEditing: (id: string) => void;
  onAnnotationDragStart: (id: string, point: Point) => void;
  onAnnotationDrag: (id: string, point: Point, shiftKey: boolean) => void;
  movingTextId: string | null;
  onHighlightResizeStart: (id: string, point: Point, handle: HighlightHandle) => void;
  onHighlightResize: (id: string, point: Point) => void;
  onHighlightResizeEnd: (id: string) => void;
  onTextResizeStart: (id: string, point: Point, handle: HighlightHandle, bounds: ResizeBounds) => void;
  onTextResize: (id: string, point: Point) => void;
  onTextResizeEnd: (id: string) => void;
  onPenCommit: (points: Point[]) => void;
  selectedAnnotationId: string | null;
  onRenderError: (message: string) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState<RenderedSize | null>(null);
  const [rendering, setRendering] = useState(false);
  const [inRange, setInRange] = useState(false);
  const [penPreview, setPenPreview] = useState<Point[] | null>(null);
  const highlightDrag = useRef<{ id: string; start: Point } | null>(null);
  const annotationDrag = useRef<{ id: string; start: Point; moved: boolean } | null>(null);
  const suppressTextClickRef = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (typeof IntersectionObserver === "undefined") {
      setInRange(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setInRange(entry.isIntersecting);
    }, { root: shell.closest(".stage-scroll"), rootMargin: "600px 0px" });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editingTextId || !textEditorRef.current) return;
    textEditorRef.current.focus();
    const length = textEditorRef.current.value.length;
    textEditorRef.current.setSelectionRange(length, length);
  }, [editingTextId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas) return;
    let active = true;
    let renderTask: pdfjs.RenderTask | null = null;
    if (inRange) {
      setRendering(true);
    } else {
      canvas.width = 0;
      canvas.height = 0;
      setRendering(false);
    }
    document
      .getPage(page.sourceIndex + 1)
      .then((pdfPage) => {
        if (!active) return;
        const rotation = ((pdfPage.rotate + page.rotation) % 360 + 360) % 360;
        const viewport = pdfPage.getViewport({ scale: zoom, rotation });
        setSize({ width: viewport.width, height: viewport.height });
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        if (!inRange) {
          setRendering(false);
          return;
        }
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not create a PDF canvas.");
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
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
  }, [document, page.sourceIndex, page.rotation, zoom, inRange, onRenderError]);

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
    if (annotationDrag.current) {
      const current = getPoint(event);
      const bounds = event.currentTarget.getBoundingClientRect();
      const dx = (current.x - annotationDrag.current.start.x) * bounds.width;
      const dy = (current.y - annotationDrag.current.start.y) * bounds.height;
      if (!annotationDrag.current.moved && !isAnnotationDrag(dx, dy)) return;
      if (!annotationDrag.current.moved) {
        annotationDrag.current.moved = true;
      }
      onAnnotationDrag(annotationDrag.current.id, current, event.shiftKey);
      return;
    }
    if (!penPreview) return;
    const point = getPoint(event);
    setPenPreview((current) => (current ? [...current, point] : null));
  };

  const handlePointerUp = () => {
    if (highlightDrag.current) {
      highlightDrag.current = null;
      onHighlightEnd();
      return;
    }
    if (annotationDrag.current?.moved) {
      const id = annotationDrag.current.id;
      if (suppressTextClickRef.current) window.clearTimeout(suppressTextClickRef.current.timer);
      const timer = window.setTimeout(() => {
        if (suppressTextClickRef.current?.id === id) suppressTextClickRef.current = null;
      }, 200);
      suppressTextClickRef.current = { id, timer };
    }
    annotationDrag.current = null;
    if (penPreview && penPreview.length > 1) onPenCommit(penPreview);
    setPenPreview(null);
  };

  const penAnnotations = annotations.filter((annotation) => annotation.type === "pen");
  const overlayStyle = size ? { width: size.width, height: size.height } : undefined;
  const beginAnnotationDrag = (id: string, event: {
    pointerId: number;
    clientX: number;
    clientY: number;
    currentTarget: Element;
  }) => {
    if (suppressTextClickRef.current) {
      window.clearTimeout(suppressTextClickRef.current.timer);
      suppressTextClickRef.current = null;
    }
    if (tool !== "select") return;
    const layer = event.currentTarget.closest(".annotation-layer") as HTMLDivElement | null;
    if (!layer) return;
    layer.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    annotationDrag.current = { id, start: point, moved: false };
    onSelectAnnotation(id);
    onAnnotationDragStart(id, point);
  };

  const shouldStartTextEditing = (id: string) => {
    if (suppressTextClickRef.current?.id !== id) return true;
    window.clearTimeout(suppressTextClickRef.current.timer);
    suppressTextClickRef.current = null;
    return false;
  };

  return (
    <div ref={shellRef} className="viewer-shell">
      {rendering && (
        <div className="rendering-indicator">
          <LoaderCircle size={16} className="spin" /> Rendering page…
        </div>
      )}
      <div className="paper-shadow" style={overlayStyle}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        {size && (
          <div
            className={`annotation-layer tool-${tool}${movingTextId ? " move-text" : ""}`}
            style={overlayStyle}
            onClick={(event) => {
              const textAnnotationElement = event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-text-annotation-id]")
                : null;
              if (textAnnotationElement) {
                const annotationId = textAnnotationElement.dataset.textAnnotationId;
                if (annotationId) {
                  onSelectAnnotation(annotationId);
                  const target = event.target instanceof Element ? event.target : null;
                  if (target?.closest(".annotation-resize-handle")) return;
                  if (tool === "text"
                    && target?.closest(".text-annotation-content")
                    && shouldStartTextEditing(annotationId)) {
                    onStartTextEditing(annotationId);
                  }
                }
                return;
              }
              if (tool !== "text") {
                if (editingTextId) onFinishTextEditing(editingTextId);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              onPlaceAnnotation({
                x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
              });
            }}
            onDoubleClick={(event) => {
              let target = event.target instanceof Element ? event.target : null;
              // In select mode the layer holds pointer capture, so the event target is the layer itself.
              // Hit-test by coordinates to find the text annotation under the cursor.
              if (target && !target.closest("[data-text-annotation-id]")) {
                target = window.document
                  .elementsFromPoint(event.clientX, event.clientY)
                  .find((element) => element.closest("[data-text-annotation-id]")) ?? target;
              }
              const textAnnotationElement = target?.closest<HTMLElement>("[data-text-annotation-id]");
              const textContent = target?.closest(".text-annotation-content") ?? textAnnotationElement?.querySelector(".text-annotation-content");
              const annotationId = textAnnotationElement?.dataset.textAnnotationId;
              if (!annotationId || !textContent
                || target?.closest(".annotation-resize-handle")
                || target?.closest(".inline-text-editor")) return;
              onSelectAnnotation(annotationId);
              if (tool === "select" && shouldStartTextEditing(annotationId)) {
                onStartTextEditing(annotationId);
              }
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
                    className={`text-annotation${isSelected ? " selected" : ""}${movingTextId === annotation.id ? " move-active" : ""}`}
                    data-text-annotation-id={annotation.id}
                    style={{
                      left: `${annotation.x * 100}%`,
                      top: `${annotation.y * 100}%`,
                      fontSize: `${annotation.fontSize * zoom}px`,
                      color: annotation.color,
                      fontFamily,
                      fontWeight: annotation.bold ? 700 : 400,
                      fontStyle: annotation.italic ? "italic" : "normal",
                      maxWidth: annotation.boxWidth !== undefined ? "100%" : undefined,
                      ...(annotation.boxWidth !== undefined ? { width: `${annotation.boxWidth * 100}%` } : {}),
                      ...(annotation.boxHeight !== undefined ? { height: `${annotation.boxHeight * 100}%` } : {}),
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAnnotation(annotation.id);
                      const target = event.target instanceof Element ? event.target : null;
                      if (tool === "text"
                        && target?.closest(".text-annotation-content")
                        && !target.closest(".annotation-resize-handle")
                        && shouldStartTextEditing(annotation.id)) {
                        onStartTextEditing(annotation.id);
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      const target = event.target instanceof Element ? event.target : null;
                      if (target?.closest(".annotation-resize-handle") || target?.closest(".inline-text-editor")) return;
                      onSelectAnnotation(annotation.id);
                      if (tool === "select"
                        && target?.closest(".text-annotation-content")
                        && !target.closest(".annotation-resize-handle")
                        && !target.closest(".inline-text-editor")
                        && shouldStartTextEditing(annotation.id)) {
                        onStartTextEditing(annotation.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginAnnotationDrag(annotation.id, event);
                    }}
                  >
                    {editingTextId === annotation.id ? (
                      <textarea
                        ref={textEditorRef}
                        className="inline-text-editor"
                        aria-label="Edit text annotation"
                        value={annotation.text}
                        rows={Math.min(20, Math.max(1, annotation.text.split("\n").length))}
                        cols={Math.min(48, Math.max(4, ...annotation.text.split("\n").map((line) => line.length)))}
                        style={{
                          width: annotation.boxWidth !== undefined ? "100%" : undefined,
                          height: annotation.boxHeight !== undefined ? "100%" : undefined,
                        }}
                        onChange={(event) => onTextChange(annotation.id, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => onFinishTextEditing(annotation.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            onFinishTextEditing(annotation.id);
                            event.currentTarget.blur();
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="text-annotation-content"
                      >
                        {annotation.text || "Text"}
                      </span>
                    )}
                    {isSelected && tool === "select" && (
                      <>
                        {(["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map((position) => (
                          <ResizeHandle
                            key={position}
                            shape="text"
                            position={position}
                            width={annotation.boxWidth}
                            height={annotation.boxHeight}
                            onResizeStart={(point, bounds) => onTextResizeStart(annotation.id, point, position, bounds)}
                            onResize={(point) => onTextResize(annotation.id, point)}
                            onResizeEnd={() => onTextResizeEnd(annotation.id)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              }
              return (
                <div
                  key={annotation.id}
                  className={`highlight-annotation${isSelected ? " selected" : ""}`}
                  data-highlight-annotation-id={annotation.id}
                  style={{
                    left: `${annotation.x * 100}%`,
                    top: `${annotation.y * 100}%`,
                    width: `${annotation.width * 100}%`,
                    height: `${annotation.height * 100}%`,
                    backgroundColor: annotation.color,
                    opacity: annotation.opacity ?? 0.35,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectAnnotation(annotation.id);
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    beginAnnotationDrag(annotation.id, event);
                  }}
                >
                  {isSelected && (
                    <>
                      {(["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map((position) => (
                        <ResizeHandle
                          key={position}
                          shape="highlight"
                          position={position}
                          width={annotation.width}
                          height={annotation.height}
                          onResizeStart={(point) => onHighlightResizeStart(annotation.id, point, position)}
                          onResize={(point) => onHighlightResize(annotation.id, point)}
                          onResizeEnd={() => onHighlightResizeEnd(annotation.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
            <svg className="pen-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {penAnnotations.map((annotation) => {
                const points = annotation.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");
                const strokeWidth = size ? (annotation.thickness / size.width) * 1000 : 3;
                return (
                  <g key={annotation.id}>
                    <polyline
                      points={points}
                      fill="none"
                      stroke={annotation.color}
                      strokeWidth={strokeWidth}
                      strokeOpacity={annotation.opacity ?? 0.88}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                    <polyline
                      points={points}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={size ? (Math.max(12, annotation.thickness) / size.width) * 1000 : 12}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents={tool === "select" ? "stroke" : "none"}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        beginAnnotationDrag(annotation.id, event);
                      }}
                    />
                  </g>
                );
              })}
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
  shape,
  position,
  width,
  height,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  shape: "highlight" | "text";
  position: HighlightHandle;
  width?: number;
  height?: number;
  onResizeStart: (point: Point, bounds: ResizeBounds) => void;
  onResize: (point: Point) => void;
  onResizeEnd?: () => void;
}) {
  const activePointerId = useRef<number | null>(null);
  const layerRectRef = useRef<DOMRect | null>(null);
  const pendingPointRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  const flushResize = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const point = pendingPointRef.current;
    pendingPointRef.current = null;
    if (point) onResizeRef.current(point);
  };

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const finishResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    flushResize();
    activePointerId.current = null;
    onResizeEndRef.current?.();
    layerRectRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <span
      className={`annotation-resize-handle ${shape}-resize-handle handle-${position}`}
      role="slider"
      tabIndex={0}
      aria-label={`Resize ${shape} ${position}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((position.includes("left") || position.includes("right") ? width ?? 0 : height ?? 0) * 100)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        const layer = event.currentTarget.closest(".annotation-layer");
        const shapeRect = event.currentTarget.parentElement?.getBoundingClientRect();
        if (!layer || !shapeRect) return;
        const rect = layer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        layerRectRef.current = rect;
        activePointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizeStart({
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        }, { width: shapeRect.width / rect.width, height: shapeRect.height / rect.height });
      }}
      onPointerMove={(event) => {
        if (activePointerId.current !== event.pointerId) return;
        const rect = layerRectRef.current;
        if (!rect) return;
        pendingPointRef.current = {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const point = pendingPointRef.current;
          pendingPointRef.current = null;
          if (point) onResizeRef.current(point);
        });
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [movingTextId, setMovingTextId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>("select");
  const [zoom, setZoom] = useState(0.9);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rightPanel, setRightPanel] = useState<"properties" | "tools">("properties");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [thumbnailDocument, setThumbnailDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const scrollToPageRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
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
    pageId: string;
    handle: HighlightHandle;
    point: Point;
    highlight: Extract<Annotation, { type: "highlight" }>;
    latest?: Extract<Annotation, { type: "highlight" }>;
  } | null>(null);
  const textResizeRef = useRef<{
    id: string;
    pageId: string;
    handle: HighlightHandle;
    point: Point;
    annotation: TextAnnotation;
    initialWidth: number;
    initialHeight: number;
    undoRecorded: boolean;
    latest?: TextAnnotation;
  } | null>(null);
  const textEditRef = useRef<{ id: string; pageId: string; undoRecorded: boolean } | null>(null);
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
    textEditRef.current = null;
    setEditingTextId(null);
    setMovingTextId(null);
    const restoredPageId = previous.selectedPageId && previous.pages.some((page) => page.id === previous.selectedPageId)
      ? previous.selectedPageId
      : previous.pages[0]?.id ?? null;
    setPages(previous.pages);
    setAnnotations(previous.annotations);
    editorStateRef.current = previous;
    setUndoCount(historyRef.current.length);
    setRedoCount(redoHistoryRef.current.length);
    scrollToPageRef.current = restoredPageId;
    setSelectedPageId(restoredPageId);
    setSelectedAnnotationId(previous.selectedAnnotationId);
  }, []);

  const redoEdit = useCallback(() => {
    const next = redoHistoryRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, cloneSnapshot(editorStateRef.current)].slice(-50);
    textEditRef.current = null;
    setEditingTextId(null);
    setMovingTextId(null);
    const restoredPageId = next.selectedPageId && next.pages.some((page) => page.id === next.selectedPageId)
      ? next.selectedPageId
      : next.pages[0]?.id ?? null;
    setPages(next.pages);
    setAnnotations(next.annotations);
    editorStateRef.current = next;
    setUndoCount(historyRef.current.length);
    setRedoCount(redoHistoryRef.current.length);
    scrollToPageRef.current = restoredPageId;
    setSelectedPageId(restoredPageId);
    setSelectedAnnotationId(next.selectedAnnotationId);
  }, []);

  const currentPageIndex = pages.findIndex((page) => page.id === selectedPageId);
  const currentPage = currentPageIndex >= 0 ? pages[currentPageIndex] : null;
  const currentAnnotations = currentPage ? annotations[currentPage.id] ?? [] : [];
  const selectedAnnotation = currentAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;

  const navigateToPage = (pageId: string | null) => {
    if (!pageId) return;
    scrollToPageRef.current = pageId;
    setSelectedPageId(pageId);
    setSelectedAnnotationId(null);
    setEditingTextId(null);
    setMovingTextId(null);
    textEditRef.current = null;
  };

  useEffect(() => {
    const pageId = scrollToPageRef.current;
    if (!pageId) return;
    document.getElementById(`page-${pageId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    scrollToPageRef.current = null;
  }, [pages, selectedPageId]);

  const handleStageScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scroller = stageScrollRef.current;
      if (!scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const pageElements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page-id]"));
      const pageId = findMostVisiblePage(
        pageElements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.dataset.pageId ?? "", top: rect.top, bottom: rect.bottom };
        }),
        bounds.top,
        bounds.bottom,
      );
      if (pageId && pageId !== selectedPageId) {
        setSelectedPageId(pageId);
        setSelectedAnnotationId(null);
        setEditingTextId(null);
        setMovingTextId(null);
        textEditRef.current = null;
      }
    });
  };

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

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
      } else if (key === "delete" && selectedAnnotation && currentPage) {
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
      scrollToPageRef.current = nextPages[0].id;
      setSelectedPageId(nextPages[0].id);
      setSelectedAnnotationId(null);
      textEditRef.current = null;
      setEditingTextId(null);
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
      scrollToPageRef.current = nextPages[0]?.id ?? null;
      setSelectedPageId(nextPages[0]?.id ?? null);
      setSelectedAnnotationId(null);
      textEditRef.current = null;
      setEditingTextId(null);
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

  const updateCurrentAnnotations = (
    update: (existing: Annotation[]) => Annotation[],
    pageId = currentPage?.id,
  ) => {
    if (!pageId) return;
    setAnnotations((existing) => ({
      ...existing,
      [pageId]: update(existing[pageId] ?? []),
    }));
  };

  const addAnnotation = (point: Point, pageId = currentPage?.id) => {
    if (!pageId || tool !== "text") return;
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
        bold: false,
        italic: false,
      };
      updateCurrentAnnotations((existing) => [...existing, annotation], pageId);
      setSelectedAnnotationId(annotation.id);
      setEditingTextId(null);
      textEditRef.current = null;
      setTool("select");
      return;
    }
  };

  const startHighlight = (point: Point, pageId = currentPage?.id): string => {
    if (!pageId) return "";
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
      opacity: 0.35,
    };
    updateCurrentAnnotations((existing) => [...existing, annotation], pageId);
    setSelectedAnnotationId(annotation.id);
    return annotation.id;
  };

  const dragHighlight = (id: string, start: Point, end: Point, pageId = currentPage?.id) => {
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
    }, false, pageId);
  };

  const startHighlightResize = (id: string, point: Point, handle: HighlightHandle, pageId = currentPage?.id) => {
    if (!pageId) return;
    const highlight = (annotations[pageId] ?? []).find(
      (annotation) => annotation.id === id && annotation.type === "highlight",
    );
    if (!highlight || highlight.type !== "highlight") return;
    recordUndo();
    highlightResizeRef.current = {
      id,
      pageId,
      handle,
      point,
      highlight: { ...highlight },
    };
  };

  const resizeHighlight = (id: string, point: Point) => {
    const initial = highlightResizeRef.current;
    if (!initial || initial.id !== id) return;
    const resized = resizeHighlightAnnotation(initial.highlight, initial.handle, initial.point, point);
    // Preview directly on the DOM; the final box is committed to state once when the drag ends.
    initial.latest = resized;
    const element = window.document.querySelector<HTMLElement>(`[data-highlight-annotation-id="${id}"]`);
    if (element) {
      element.style.left = `${resized.x * 100}%`;
      element.style.top = `${resized.y * 100}%`;
      element.style.width = `${resized.width * 100}%`;
      element.style.height = `${resized.height * 100}%`;
    }
  };

  const finishHighlightResize = (id: string) => {
    const initial = highlightResizeRef.current;
    if (!initial || initial.id !== id) return;
    highlightResizeRef.current = null;
    const resized = initial.latest;
    if (!resized) return;
    updateAnnotation(id, {
      x: resized.x,
      y: resized.y,
      width: resized.width,
      height: resized.height,
    }, false, initial.pageId);
  };

  const startTextResize = (
    id: string,
    point: Point,
    handle: HighlightHandle,
    bounds: ResizeBounds,
    pageId = currentPage?.id,
  ) => {
    if (!pageId) return;
    const annotation = (annotations[pageId] ?? []).find(
      (item) => item.id === id && item.type === "text",
    );
    if (!annotation || annotation.type !== "text") return;
    textResizeRef.current = {
      id,
      pageId,
      handle,
      point,
      annotation: { ...annotation },
      initialWidth: annotation.boxWidth ?? bounds.width,
      initialHeight: annotation.boxHeight ?? bounds.height,
      undoRecorded: false,
    };
  };

  const resizeTextBox = (id: string, point: Point) => {
    const initial = textResizeRef.current;
    if (!initial || initial.id !== id) return;
    const resized = resizeTextAnnotation(
      initial.annotation,
      initial.handle,
      initial.point,
      point,
      initial.initialWidth,
      initial.initialHeight,
    );
    // Preview directly on the DOM so dragging does not re-render the whole app on every frame.
    // The final box is committed to state once, when the drag ends.
    initial.latest = resized;
    const element = window.document.querySelector<HTMLElement>(`[data-text-annotation-id="${id}"]`);
    if (element) {
      element.style.left = `${resized.x * 100}%`;
      element.style.top = `${resized.y * 100}%`;
      element.style.width = `${(resized.boxWidth ?? 0) * 100}%`;
      element.style.height = `${(resized.boxHeight ?? 0) * 100}%`;
    }
  };

  const finishTextResize = (id: string) => {
    const initial = textResizeRef.current;
    if (!initial || initial.id !== id) return;
    textResizeRef.current = null;
    const resized = initial.latest;
    if (!resized) return;
    const initialWidth = initial.annotation.boxWidth ?? initial.initialWidth;
    const initialHeight = initial.annotation.boxHeight ?? initial.initialHeight;
    if (resized.x === initial.annotation.x
      && resized.y === initial.annotation.y
      && resized.boxWidth === initialWidth
      && resized.boxHeight === initialHeight) return;
    recordUndo();
    updateCurrentAnnotations((existing) => existing.map((item) => item.id === id ? resized : item), initial.pageId);
  };

  const addPenAnnotation = (points: Point[], pageId = currentPage?.id) => {
    if (!pageId) return;
    recordUndo();
    const annotation: PenAnnotation = {
      id: crypto.randomUUID(),
      type: "pen",
      x: 0,
      y: 0,
      points,
      color: "#315ee8",
      thickness: 2.4,
      opacity: 0.88,
    };
    updateCurrentAnnotations((existing) => [...existing, annotation], pageId);
    setSelectedAnnotationId(annotation.id);
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>, saveUndo = true, pageId = currentPage?.id) => {
    if (saveUndo) recordUndo();
    updateCurrentAnnotations((existing) => existing.map((item) => item.id === id ? { ...item, ...patch } as Annotation : item), pageId);
  };

  const startTextEditing = (id: string, pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedAnnotationId(id);
    setEditingTextId(id);
    setMovingTextId(null);
    textEditRef.current = { id, pageId, undoRecorded: false };
  };

  const updateTextAnnotation = (id: string, text: string, pageId = currentPage?.id) => {
    if (!pageId) return;
    let edit = textEditRef.current;
    if (!edit || edit.id !== id || edit.pageId !== pageId) {
      edit = { id, pageId, undoRecorded: false };
      textEditRef.current = edit;
    }
    if (!edit.undoRecorded) {
      recordUndo();
      edit.undoRecorded = true;
    }
    updateAnnotation(id, { text }, false, pageId);
  };

  const finishTextEditing = (id: string) => {
    if (textEditRef.current?.id === id) textEditRef.current = null;
    setEditingTextId((current) => current === id ? null : current);
  };

  const annotationDragRef = useRef<{
    id: string;
    pageId: string;
    start: Point;
    annotation: Annotation;
    undoRecorded: boolean;
  } | null>(null);

  const startAnnotationDrag = (id: string, point: Point, pageId = currentPage?.id) => {
    if (!pageId) return;
    const annotation = (annotations[pageId] ?? []).find((item) => item.id === id);
    if (!annotation) return;
    annotationDragRef.current = {
      id,
      pageId,
      start: point,
      annotation: annotation.type === "pen"
        ? { ...annotation, points: annotation.points.map((item) => ({ ...item })) }
        : { ...annotation },
      undoRecorded: false,
    };
  };

  const dragAnnotation = (id: string, point: Point, pageId = currentPage?.id, shiftKey = false) => {
    const drag = annotationDragRef.current;
    if (!drag || drag.id !== id) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.undoRecorded && Math.hypot(dx, dy) < 0.002) return;
    if (!drag.undoRecorded) {
      recordUndo();
      drag.undoRecorded = true;
    }
    const delta = drag.annotation.type === "text"
      ? constrainTextDragDelta(dx, dy, shiftKey)
      : { x: dx, y: dy };
    const moved = moveAnnotation(drag.annotation, delta.x, delta.y);
    updateCurrentAnnotations((existing) => existing.map((item) => item.id === id ? moved : item), pageId);
  };

  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotationId) return;
    recordUndo();
    updateCurrentAnnotations((existing) => existing.filter((item) => item.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
    setMovingTextId(null);
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
    scrollToPageRef.current = duplicate.id;
    setSelectedPageId(duplicate.id);
    setSelectedAnnotationId(null);
    textEditRef.current = null;
    setEditingTextId(null);
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
    scrollToPageRef.current = nextPages[nextIndex].id;
    setSelectedPageId(nextPages[nextIndex].id);
    setSelectedAnnotationId(null);
    textEditRef.current = null;
    setEditingTextId(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  const annotationFont = selectedAnnotation?.type === "text" ? selectedAnnotation.font : "Helvetica";

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
                    onClick={() => navigateToPage(page.id)}
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
                  <button className={`tool-button${tool === "text" ? " active" : ""}`} onClick={() => { setMovingTextId(null); setTool("text"); }} title="Add text">
                    <Type size={16} /><span>Text</span>
                  </button>
                  <button className={`tool-button${tool === "highlight" ? " active" : ""}`} onClick={() => { setMovingTextId(null); setTool("highlight"); }} title="Highlight">
                    <Highlighter size={16} /><span>Highlight</span>
                  </button>
                  <button className={`tool-button${tool === "draw" ? " active" : ""}`} onClick={() => { setMovingTextId(null); setTool("draw"); }} title="Draw">
                    <PenLine size={16} /><span>Draw</span>
                  </button>
                </div>
                <div className="toolbar-right">
                  <button className="icon-button mobile-inspector-toggle" onClick={() => setInspectorOpen(true)} aria-label="Open edit panel" title="Open edit panel"><PanelRight size={16} /></button>
                  <span className="page-indicator">
                    <button className="icon-button mini" disabled={currentPageIndex <= 0} onClick={() => navigateToPage(pages[currentPageIndex - 1]?.id ?? null)} aria-label="Previous page"><ChevronLeft size={16} /></button>
                    <b>{currentPageIndex + 1}</b><span>/</span>{pages.length}
                    <button className="icon-button mini" disabled={currentPageIndex >= pages.length - 1} onClick={() => navigateToPage(pages[currentPageIndex + 1]?.id ?? null)} aria-label="Next page"><ChevronRight size={16} /></button>
                  </span>
                  <span className="toolbar-separator" />
                  <button className="icon-button mini" onClick={() => setZoom((value) => Math.max(0.4, Math.round((value - 0.1) * 100) / 100))} aria-label="Zoom out"><ZoomOut size={16} /></button>
                  <span className="zoom-label">{Math.round(zoom * 100)}%</span>
                  <button className="icon-button mini" onClick={() => setZoom((value) => Math.min(1.6, Math.round((value + 0.1) * 100) / 100))} aria-label="Zoom in"><ZoomIn size={16} /></button>
                </div>
              </div>

              {error && <div className="alert alert-error"><Info size={15} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
              {notice && !error && <div className="alert alert-success"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}

              {pages.length > 0 ? (
                <div className="page-stage">
                  <div ref={stageScrollRef} className="stage-scroll" onScroll={handleStageScroll}>
                    <div className="stage-content">
                      {pages.map((page, index) => (
                        <section key={page.id} id={`page-${page.id}`} className="continuous-page" data-page-id={page.id}>
                          <div className="stage-page-caption">
                            <span>{getPageLabel(index, pages.length)}</span>
                            {tool !== "select" && <span className="mode-hint">
                              {tool === "text" ? "Click the page to place text" : tool === "highlight" ? "Click and drag to size a highlight" : "Draw on the page"}
                            </span>}
                          </div>
                          <Viewer
                            key={`${page.id}-${page.rotation}`}
                            document={thumbnailDocument}
                            page={page}
                            annotations={annotations[page.id] ?? []}
                            zoom={zoom}
                            tool={tool}
                            onPlaceAnnotation={(point) => {
                              setSelectedPageId(page.id);
                              addAnnotation(point, page.id);
                            }}
                            onHighlightStart={(point) => {
                              setSelectedPageId(page.id);
                              return startHighlight(point, page.id);
                            }}
                            onHighlightDrag={(id, start, end) => dragHighlight(id, start, end, page.id)}
                            onHighlightEnd={() => setTool("select")}
                            onSelectAnnotation={(id) => {
                              setSelectedPageId(page.id);
                              setSelectedAnnotationId(id);
                              setEditingTextId(null);
                              setMovingTextId((current) => current === id ? current : null);
                              textEditRef.current = null;
                            }}
                            movingTextId={page.id === selectedPageId ? movingTextId : null}
                            editingTextId={page.id === selectedPageId ? editingTextId : null}
                            onStartTextEditing={(id) => startTextEditing(id, page.id)}
                            onTextChange={(id, text) => updateTextAnnotation(id, text, page.id)}
                            onFinishTextEditing={finishTextEditing}
                            onAnnotationDragStart={(id, point) => startAnnotationDrag(id, point, page.id)}
                            onAnnotationDrag={(id, point, shiftKey) => dragAnnotation(id, point, page.id, shiftKey)}
                            onTextResizeStart={(id, point, handle, bounds) => startTextResize(id, point, handle, bounds, page.id)}
                            onTextResize={resizeTextBox}
                            onTextResizeEnd={finishTextResize}
                            onHighlightResizeStart={(id, point, handle) => startHighlightResize(id, point, handle, page.id)}
                            onHighlightResize={resizeHighlight}
                            onHighlightResizeEnd={finishHighlightResize}
                            onPenCommit={(points) => {
                              setSelectedPageId(page.id);
                              addPenAnnotation(points, page.id);
                            }}
                            selectedAnnotationId={page.id === selectedPageId ? selectedAnnotationId : null}
                            onRenderError={reportRenderError}
                          />
                        </section>
                      ))}
                    </div>
                  </div>
                  <div className="stage-bottom">
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
                      <button
                        type="button"
                        className={`action-row text-move-control${movingTextId === selectedAnnotation.id ? " active" : ""}`}
                        aria-pressed={movingTextId === selectedAnnotation.id}
                        onClick={() => {
                          const moveActive = movingTextId === selectedAnnotation.id;
                          setTool("select");
                          setEditingTextId(null);
                          textEditRef.current = null;
                          setMovingTextId(moveActive ? null : selectedAnnotation.id);
                        }}
                      >
                        <MoveUpRight size={16} /><span>{movingTextId === selectedAnnotation.id ? "Move mode on" : "Move text box"}</span>
                      </button>
                      {movingTextId === selectedAnnotation.id && (
                        <p className="resize-hint">Drag the selected box to move it. Hold Shift to constrain movement to one axis.</p>
                      )}
                      <label className="field-label" htmlFor="text-content">Text</label>
                      <textarea id="text-content" className="text-input" value={selectedAnnotation.text} onChange={(event) => updateTextAnnotation(selectedAnnotation.id, event.target.value)} rows={3} />
                      <div className="field-row"><span className="field-label">Style</span><div className="text-style-buttons">
                        <button type="button" className={selectedAnnotation.bold ? "active" : ""} aria-label="Bold text" aria-pressed={Boolean(selectedAnnotation.bold)} onClick={() => updateAnnotation(selectedAnnotation.id, { bold: !selectedAnnotation.bold })}><Bold size={15} /></button>
                        <button type="button" className={selectedAnnotation.italic ? "active" : ""} aria-label="Italic text" aria-pressed={Boolean(selectedAnnotation.italic)} onClick={() => updateAnnotation(selectedAnnotation.id, { italic: !selectedAnnotation.italic })}><Italic size={15} /></button>
                      </div></div>
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
                      <div className="field-row"><label className="field-label" htmlFor="highlight-opacity">Opacity</label><span className="field-value">{Math.round((selectedAnnotation.opacity ?? 0.35) * 100)}%</span></div>
                      <input id="highlight-opacity" aria-label="Highlight opacity" type="range" min="10" max="100" step="1" value={Math.round((selectedAnnotation.opacity ?? 0.35) * 100)} onChange={(event) => updateAnnotation(selectedAnnotation.id, { opacity: Number(event.target.value) / 100 })} />
                      <button className="delete-markup" title="Delete selected highlight (Delete)" onClick={deleteSelectedAnnotation}><Trash2 size={15} /> Delete highlight <kbd>Delete</kbd></button>
                    </div>
                  ) : selectedAnnotation?.type === "pen" ? (
                    <div className="property-section">
                      <p className="selected-markup-info"><PenLine size={16} /> Freehand drawing</p>
                      <ColorPicker value={selectedAnnotation.color} onChange={(color) => updateAnnotation(selectedAnnotation.id, { color })} />
                      <div className="field-row"><label className="field-label" htmlFor="pen-opacity">Opacity</label><span className="field-value">{Math.round((selectedAnnotation.opacity ?? 0.88) * 100)}%</span></div>
                      <input id="pen-opacity" aria-label="Drawing opacity" type="range" min="10" max="100" step="1" value={Math.round((selectedAnnotation.opacity ?? 0.88) * 100)} onChange={(event) => updateAnnotation(selectedAnnotation.id, { opacity: Number(event.target.value) / 100 })} />
                      <div className="field-row"><label className="field-label" htmlFor="pen-thickness">Stroke width</label><span className="field-value">{selectedAnnotation.thickness.toFixed(1)} px</span></div>
                      <input id="pen-thickness" aria-label="Stroke width" type="range" min="1" max="12" step="0.5" value={selectedAnnotation.thickness} onChange={(event) => updateAnnotation(selectedAnnotation.id, { thickness: Number(event.target.value) })} />
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

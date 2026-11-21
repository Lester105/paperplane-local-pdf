import type { Annotation, HighlightAnnotation, TextAnnotation } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type HighlightResizeHandle = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type NormalizedPoint = { x: number; y: number };

export function isAnnotationDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= 4;
}

export function constrainTextDragDelta(dx: number, dy: number, shiftKey: boolean): NormalizedPoint {
  if (!shiftKey) return { x: dx, y: dy };
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };
}

export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.type === "pen") {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({
        x: clamp(point.x + dx, 0, 1),
        y: clamp(point.y + dy, 0, 1),
      })),
    };
  }

  return {
    ...annotation,
    x: clamp(annotation.x + dx, 0, annotation.type === "highlight" ? 1 - annotation.width : 1 - (annotation.boxWidth ?? 0)),
    y: clamp(annotation.y + dy, 0, annotation.type === "highlight" ? 1 - annotation.height : 1 - (annotation.boxHeight ?? 0)),
  };
}

export function resizeHighlightAnnotation(
  annotation: HighlightAnnotation,
  handle: HighlightResizeHandle,
  start: NormalizedPoint,
  end: NormalizedPoint,
): HighlightAnnotation {
  const minWidth = 0.008;
  const minHeight = 0.008;
  let { x, y, width, height } = annotation;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const movesLeft = handle.includes("left");
  const movesRight = handle.includes("right");
  const movesTop = handle.includes("top");
  const movesBottom = handle.includes("bottom");

  if (movesLeft) {
    x = Math.max(0, Math.min(annotation.x + annotation.width - minWidth, annotation.x + dx));
    width = annotation.x + annotation.width - x;
  } else if (movesRight) {
    width = Math.max(minWidth, Math.min(1 - annotation.x, annotation.width + dx));
  }

  if (movesTop) {
    y = Math.max(0, Math.min(annotation.y + annotation.height - minHeight, annotation.y + dy));
    height = annotation.y + annotation.height - y;
  } else if (movesBottom) {
    height = Math.max(minHeight, Math.min(1 - annotation.y, annotation.height + dy));
  }

  return { ...annotation, x, y, width, height };
}

export function resizeTextAnnotation(
  annotation: TextAnnotation,
  handle: HighlightResizeHandle,
  start: NormalizedPoint,
  end: NormalizedPoint,
  initialWidth: number,
  initialHeight: number,
): TextAnnotation {
  const minWidth = 0.02;
  const minHeight = 0.02;
  let { x, y } = annotation;
  let width = annotation.boxWidth ?? initialWidth;
  let height = annotation.boxHeight ?? initialHeight;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const movesLeft = handle.includes("left");
  const movesRight = handle.includes("right");
  const movesTop = handle.includes("top");
  const movesBottom = handle.includes("bottom");

  if (movesLeft) {
    const right = x + width;
    x = clamp(x + dx, 0, right - minWidth);
    width = right - x;
  } else if (movesRight) {
    width = clamp(width + dx, minWidth, 1 - x);
  }

  if (movesTop) {
    const bottom = y + height;
    y = clamp(y + dy, 0, bottom - minHeight);
    height = bottom - y;
  } else if (movesBottom) {
    height = clamp(height + dy, minHeight, 1 - y);
  }

  return { ...annotation, x, y, boxWidth: width, boxHeight: height };
}

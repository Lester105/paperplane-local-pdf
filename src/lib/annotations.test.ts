import { describe, expect, it } from "vitest";
import {
  constrainTextDragDelta,
  isAnnotationDrag,
  moveAnnotation,
  resizeHighlightAnnotation,
  resizeTextAnnotation,
} from "./annotations";
import type { Annotation, HighlightAnnotation, TextAnnotation } from "../types";

describe("moveAnnotation", () => {
  it("distinguishes plain click jitter from an intentional box drag", () => {
    expect(isAnnotationDrag(1, 1)).toBe(false);
    expect(isAnnotationDrag(4, 0)).toBe(true);
    expect(isAnnotationDrag(0, -5)).toBe(true);
  });

  it("constrains Shift-drag to the dominant axis", () => {
    expect(constrainTextDragDelta(0.2, 0.1, true)).toEqual({ x: 0.2, y: 0 });
    expect(constrainTextDragDelta(0.1, -0.2, true)).toEqual({ x: 0, y: -0.2 });
    expect(constrainTextDragDelta(0.2, 0.1, false)).toEqual({ x: 0.2, y: 0.1 });
  });

  it("moves text while keeping the original annotation unchanged", () => {
    const text: Annotation = {
      id: "text",
      type: "text",
      x: 0.25,
      y: 0.4,
      text: "Note",
      font: "Helvetica",
      fontSize: 16,
      color: "#20242b",
      bold: true,
    };

    expect(moveAnnotation(text, 0.1, -0.15)).toMatchObject({ x: 0.35, y: 0.25, bold: true });
    expect(text).toMatchObject({ x: 0.25, y: 0.4 });
  });

  it("keeps a moved highlight fully inside the page", () => {
    const highlight: HighlightAnnotation = {
      id: "highlight",
      type: "highlight",
      x: 0.2,
      y: 0.3,
      width: 0.25,
      height: 0.1,
      color: "#ffdb66",
    };

    expect(moveAnnotation(highlight, 0.9, 0.9)).toMatchObject({ x: 0.75, y: 0.9 });
  });

  it("moves each pen point and clamps it to the page", () => {
    const pen: Annotation = {
      id: "pen",
      type: "pen",
      x: 0,
      y: 0,
      points: [{ x: 0.2, y: 0.8 }, { x: 0.95, y: 0.9 }],
      color: "#315ee8",
      thickness: 2.4,
    };

    expect(moveAnnotation(pen, 0.2, 0.3)).toMatchObject({
      points: [{ x: 0.4, y: 1 }, { x: 1, y: 1 }],
    });
  });

  it.each([
    ["left", { x: 0.2, y: 0.3 }, { x: 0.1, y: 0.3 }, { x: 0.1, y: 0.2, width: 0.4, height: 0.2 }],
    ["right", { x: 0.5, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.2, y: 0.2, width: 0.4, height: 0.2 }],
    ["top", { x: 0.35, y: 0.2 }, { x: 0.35, y: 0.1 }, { x: 0.2, y: 0.1, width: 0.3, height: 0.3 }],
    ["bottom", { x: 0.35, y: 0.4 }, { x: 0.35, y: 0.5 }, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }],
  ] as const)("resizes the %s edge independently", (handle, start, end, expected) => {
    const highlight: HighlightAnnotation = {
      id: "highlight",
      type: "highlight",
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.2,
      color: "#ffdb66",
    };

    const resized = resizeHighlightAnnotation(highlight, handle, start, end);

    expect(resized.x).toBeCloseTo(expected.x);
    expect(resized.y).toBeCloseTo(expected.y);
    expect(resized.width).toBeCloseTo(expected.width);
    expect(resized.height).toBeCloseTo(expected.height);
  });

  it("resizes both dimensions from a corner and clamps to the page", () => {
    const highlight: HighlightAnnotation = {
      id: "highlight",
      type: "highlight",
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.2,
      color: "#ffdb66",
    };

    expect(resizeHighlightAnnotation(highlight, "bottom-right", { x: 0.5, y: 0.4 }, { x: 1.1, y: 1.1 }))
      .toMatchObject({ x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
  });

  it.each([
    ["left", { x: 0.2, y: 0.3 }, { x: 0.1, y: 0.3 }, { x: 0.1, y: 0.2, boxWidth: 0.4, boxHeight: 0.2 }],
    ["right", { x: 0.5, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.2, y: 0.2, boxWidth: 0.4, boxHeight: 0.2 }],
    ["top", { x: 0.35, y: 0.2 }, { x: 0.35, y: 0.1 }, { x: 0.2, y: 0.1, boxWidth: 0.3, boxHeight: 0.3 }],
    ["bottom", { x: 0.35, y: 0.4 }, { x: 0.35, y: 0.5 }, { x: 0.2, y: 0.2, boxWidth: 0.3, boxHeight: 0.3 }],
  ] as const)("resizes a text box from the %s edge", (handle, start, end, expected) => {
    const text: TextAnnotation = {
      id: "text",
      type: "text",
      x: 0.2,
      y: 0.2,
      text: "Wrapped text",
      font: "Helvetica",
      fontSize: 16,
      color: "#20242b",
      boxWidth: 0.3,
      boxHeight: 0.2,
    };

    const resized = resizeTextAnnotation(text, handle, start, end, 0.3, 0.2);

    expect(resized.x).toBeCloseTo(expected.x);
    expect(resized.y).toBeCloseTo(expected.y);
    expect(resized.boxWidth).toBeCloseTo(expected.boxWidth);
    expect(resized.boxHeight).toBeCloseTo(expected.boxHeight);
  });

  it.each([
    ["top-left", { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1, boxWidth: 0.4, boxHeight: 0.3 }],
    ["top-right", { x: 0.5, y: 0.2 }, { x: 0.6, y: 0.1 }, { x: 0.2, y: 0.1, boxWidth: 0.4, boxHeight: 0.3 }],
    ["bottom-left", { x: 0.2, y: 0.4 }, { x: 0.1, y: 0.5 }, { x: 0.1, y: 0.2, boxWidth: 0.4, boxHeight: 0.3 }],
    ["bottom-right", { x: 0.5, y: 0.4 }, { x: 0.6, y: 0.5 }, { x: 0.2, y: 0.2, boxWidth: 0.4, boxHeight: 0.3 }],
  ] as const)("resizes a text box from the %s corner", (handle, start, end, expected) => {
    const text: TextAnnotation = {
      id: "text",
      type: "text",
      x: 0.2,
      y: 0.2,
      text: "Wrapped text",
      font: "Helvetica",
      fontSize: 16,
      color: "#20242b",
      boxWidth: 0.3,
      boxHeight: 0.2,
    };

    const resized = resizeTextAnnotation(text, handle, start, end, 0.3, 0.2);

    expect(resized.x).toBeCloseTo(expected.x);
    expect(resized.y).toBeCloseTo(expected.y);
    expect(resized.boxWidth).toBeCloseTo(expected.boxWidth);
    expect(resized.boxHeight).toBeCloseTo(expected.boxHeight);
  });

  it("uses measured size for legacy text boxes and clamps corner resize to page bounds", () => {
    const text: TextAnnotation = {
      id: "text",
      type: "text",
      x: 0.7,
      y: 0.7,
      text: "Legacy text",
      font: "Helvetica",
      fontSize: 16,
      color: "#20242b",
    };

    const resized = resizeTextAnnotation(text, "bottom-right", { x: 0.9, y: 0.9 }, { x: 1.3, y: 1.3 }, 0.2, 0.2);
    expect(resized.x).toBeCloseTo(0.7);
    expect(resized.y).toBeCloseTo(0.7);
    expect(resized.boxWidth).toBeCloseTo(0.3);
    expect(resized.boxHeight).toBeCloseTo(0.3);
  });

  it("preserves sub-pixel drag deltas for immediate resizing", () => {
    const text: TextAnnotation = {
      id: "text",
      type: "text",
      x: 0.2,
      y: 0.2,
      text: "Wrapped text",
      font: "Helvetica",
      fontSize: 16,
      color: "#20242b",
      boxWidth: 0.3,
      boxHeight: 0.2,
    };

    const resized = resizeTextAnnotation(
      text,
      "right",
      { x: 0.5, y: 0.3 },
      { x: 0.5005, y: 0.3 },
      0.3,
      0.2,
    );

    expect(resized.boxWidth).toBeCloseTo(0.3005, 5);
  });
});

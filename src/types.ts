export type FontName = "Helvetica" | "TimesRoman" | "Courier";
export type ToolMode = "select" | "text" | "highlight" | "draw";

export interface PageItem {
  id: string;
  sourceIndex: number;
  rotation: number;
}

interface PositionedAnnotation {
  id: string;
  x: number;
  y: number;
}

export interface TextAnnotation extends PositionedAnnotation {
  type: "text";
  text: string;
  font: FontName;
  fontSize: number;
  color: string;
}

export interface HighlightAnnotation extends PositionedAnnotation {
  type: "highlight";
  width: number;
  height: number;
  color: string;
}

export interface PenAnnotation extends PositionedAnnotation {
  type: "pen";
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
}

export type Annotation = TextAnnotation | HighlightAnnotation | PenAnnotation;
export type AnnotationMap = Record<string, Annotation[]>;

export interface DraftSnapshot {
  fileName: string;
  sourceBytes: Uint8Array;
  pages: PageItem[];
  annotations: AnnotationMap;
  savedAt: number;
}

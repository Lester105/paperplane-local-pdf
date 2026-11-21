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
  bold?: boolean;
  italic?: boolean;
  boxWidth?: number;
  boxHeight?: number;
}

export interface HighlightAnnotation extends PositionedAnnotation {
  type: "highlight";
  width: number;
  height: number;
  color: string;
  opacity?: number;
}

export interface PenAnnotation extends PositionedAnnotation {
  type: "pen";
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  opacity?: number;
}

export type Annotation = TextAnnotation | HighlightAnnotation | PenAnnotation;
export type AnnotationMap = Record<string, Annotation[]>;

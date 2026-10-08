export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  type: "stroke";
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: Point[];
};

export type ImageMark = {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NoteMark = {
  id: string;
  type: "note";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  strokes: Stroke[];
  noteWidth: number;
  noteHeight: number;
};

export type Mark = Stroke | ImageMark | NoteMark;

export type ReaderPage = {
  id: string;
  sourcePage: number | null;
  width: number;
  height: number;
  marks: Mark[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pageId?: string;
  quotedText?: string;
  images?: string[];
};

export type PageRect = { x: number; y: number; width: number; height: number };
export type AiSelection = { kind: "underline" | "circle" | "mark"; text: string; boxes: PageRect[] };
export type AiMark = { id: string; pageId: string; points: Point[]; selection?: AiSelection; textOverride?: string };

export type ReaderDocument = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentPage: number;
  pages: ReaderPage[];
  chat: ChatMessage[];
};

export type ToolName = "pan" | "pen" | "highlighter" | "eraser" | "lasso" | "ask" | "note";

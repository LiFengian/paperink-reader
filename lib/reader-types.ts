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

export type Mark = Stroke | ImageMark;

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
};

export type ReaderDocument = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentPage: number;
  pages: ReaderPage[];
  chat: ChatMessage[];
};

export type ToolName = "pan" | "pen" | "highlighter" | "eraser" | "lasso" | "ask";

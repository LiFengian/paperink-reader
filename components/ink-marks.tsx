"use client";
import { memo } from "react";
import { pathFromPoints } from "../lib/geometry";
import type { Mark } from "../lib/reader-types";

const InkMark = memo(function InkMark({ mark }: { mark: Mark }) {
  return mark.type === "stroke"
    ? <path d={pathFromPoints(mark.points)} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.tool === "highlighter" ? 0.38 : 1} />
    : <image href={mark.src} x={mark.x} y={mark.y} width={mark.width} height={mark.height} preserveAspectRatio="none" />;
});

export const InkMarks = memo(function InkMarks({ marks }: { marks: Mark[] }) {
  return <>{marks.map(mark => <InkMark key={mark.id} mark={mark} />)}</>;
});

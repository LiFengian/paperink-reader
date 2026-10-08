"use client";
import { memo } from "react";
import { pathFromPoints } from "../lib/geometry";
import type { Mark } from "../lib/reader-types";

const InkMark = memo(function InkMark({ mark }: { mark: Mark }) {
  if (mark.type === "note") return <g className="sticky-note-marker" data-note-id={mark.id} role="button" tabIndex={0} aria-label="打开便签" transform={`translate(${mark.x} ${mark.y}) scale(${mark.width / 28} ${mark.height / 28})`}>
    <title>{mark.text.trim().split("\n")[0] || (mark.strokes.length ? "手写便签" : "点击记录便签")}</title>
    <rect x="-4" y="-4" width="36" height="36" fill="transparent" />
    <path d="M 4 1 H 20 L 27 8 V 24 Q 27 27 24 27 H 4 Q 1 27 1 24 V 4 Q 1 1 4 1 Z" fill="#ffe89a" stroke="#c5993e" strokeWidth="1.1" />
    <path d="M 20 1 V 8 H 27" fill="#f5cc66" stroke="#c5993e" strokeWidth="1.1" />
    <path d="M 7 13 H 20 M 7 18 H 17" fill="none" stroke="#98702e" strokeWidth="1.6" strokeLinecap="round" />
    {(mark.text.trim() || mark.strokes.length > 0) && <circle cx="24" cy="24" r="3" fill="#427c63" stroke="white" strokeWidth="1" />}
  </g>;
  return mark.type === "stroke"
    ? <path d={pathFromPoints(mark.points)} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.tool === "highlighter" ? 0.38 : 1} />
    : <image href={mark.src} x={mark.x} y={mark.y} width={mark.width} height={mark.height} preserveAspectRatio="none" />;
});

export const InkMarks = memo(function InkMarks({ marks }: { marks: Mark[] }) {
  return <>{marks.map(mark => <InkMark key={mark.id} mark={mark} />)}</>;
});

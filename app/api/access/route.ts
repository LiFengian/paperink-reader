import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, accessCodeMatches, hasPaperInkAccess, sessionToken } from "../../../lib/access";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { authorized: await hasPaperInkAccess(request), configured: Boolean(process.env.PAPERINK_ACCESS_CODE) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!process.env.PAPERINK_ACCESS_CODE) {
    return NextResponse.json({ error: "访问服务尚未配置。" }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") || 0) > 256) {
    return NextResponse.json({ error: "访问码无效。" }, { status: 400 });
  }
  let code: unknown;
  try { code = (await request.json() as { code?: unknown }).code; }
  catch { return NextResponse.json({ error: "访问码无效。" }, { status: 400 }); }
  if (typeof code !== "string" || !(await accessCodeMatches(code))) {
    return NextResponse.json({ error: "访问码不正确。" }, { status: 401 });
  }
  const response = NextResponse.json({ authorized: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ACCESS_COOKIE, (await sessionToken())!, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "strict",
    path: "/api",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

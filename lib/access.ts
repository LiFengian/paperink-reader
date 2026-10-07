import type { NextRequest } from "next/server";

export const ACCESS_COOKIE = "paperink_access";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function equalFixedLength(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export async function accessCodeMatches(code: string) {
  const configured = process.env.PAPERINK_ACCESS_CODE;
  if (!configured || !code || code.length > 128) return false;
  return equalFixedLength(await sha256(code), await sha256(configured));
}

export async function sessionToken() {
  const configured = process.env.PAPERINK_ACCESS_CODE;
  if (!configured) return null;
  return sha256(`paperink-session-v1:${configured}`);
}

export async function hasPaperInkAccess(request: NextRequest) {
  const actual = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!actual) return false;
  const expected = await sessionToken();
  return expected ? equalFixedLength(actual, expected) : false;
}

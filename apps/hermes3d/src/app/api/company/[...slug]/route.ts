import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
const ALLINONE_HOME = process.env.ALLINONE_HOME || os.homedir() + "/ALLINONE-AGENT";


export const runtime = "nodejs";

const SECRET_FILE_PATH = `${ALLINONE_HOME}\\config\\secrets\\office-bridge-auth.json`;
const DEFAULT_BRIDGE_BASE = process.env.OFFICE_BRIDGE_HTTP_URL || "http://127.0.0.1:3210";

function loadBridgeToken(): string {
  const raw = JSON.parse(fs.readFileSync(SECRET_FILE_PATH, "utf8")) as { bridgeToken?: string };
  const token = String(raw.bridgeToken || "").trim();
  if (!token) throw new Error("Office Bridge token unavailable.");
  return token;
}

function isTrustedSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const secFetch = request.headers.get("sec-fetch-site");
    if (secFetch && secFetch !== "same-origin" && secFetch !== "none") {
      return false;
    }
    return true;
  }
  const normalized = origin.trim().toLowerCase().replace(/\/$/, "");
  const hostHeader = (request.headers.get("host") || "").trim().toLowerCase();
  return (
    normalized === `http://${hostHeader}` ||
    normalized === `https://${hostHeader}` ||
    normalized === "http://127.0.0.1:3200" ||
    normalized === "http://localhost:3200"
  );
}

async function forwardToOfficeBridge(
  request: Request,
  context: { params: Promise<{ slug: string[] }> }
): Promise<Response> {
  const method = request.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";

  if (isMutation && !isTrustedSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "CSRF validation failed: untrusted Origin." },
      { status: 403 }
    );
  }

  try {
    const { slug } = await context.params;
    const cleanSegments = (slug || []).map((s) => encodeURIComponent(s));
    const urlObj = new URL(request.url);
    const targetUrl = `${DEFAULT_BRIDGE_BASE.replace(/\/$/, "")}/api/office-bridge/${cleanSegments.join("/")}${urlObj.search}`;

    const bridgeToken = loadBridgeToken();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${bridgeToken}`,
    };

    const roleHeader = request.headers.get("x-office-actor-role");
    if (roleHeader) headers["X-Office-Actor-Role"] = roleHeader;
    const callerHeader = request.headers.get("x-office-caller-id");
    if (callerHeader) headers["X-Office-Caller-Id"] = callerHeader;

    let bodyText: string | undefined;
    if (isMutation) {
      headers["Content-Type"] = "application/json";
      bodyText = await request.text();
    }

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: isMutation ? bodyText || "{}" : undefined,
      cache: "no-store",
      signal: request.signal,
    });

    const responseText = await upstream.text();
    return new NextResponse(responseText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Office Bridge proxy unavailable.";
    return NextResponse.json(
      { ok: false, error: msg.includes("ECONNREFUSED") ? "Office Bridge offline." : "Proxy error." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export const GET = forwardToOfficeBridge;
export const POST = forwardToOfficeBridge;
export const PATCH = forwardToOfficeBridge;
export const PUT = forwardToOfficeBridge;
export const DELETE = forwardToOfficeBridge;

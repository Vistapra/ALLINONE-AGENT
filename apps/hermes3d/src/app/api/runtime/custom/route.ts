import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
const ALLINONE_HOME = process.env.ALLINONE_HOME || os.homedir() + "/ALLINONE-AGENT";


export const runtime = "nodejs";

const SECRET_FILE_PATH = `${ALLINONE_HOME}\\config\\secrets\\office-bridge-auth.json`;

const loadServerBridgeAuthHeader = (): Record<string, string> => {
  try {
    if (!fs.existsSync(SECRET_FILE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(SECRET_FILE_PATH, "utf8")) as { bridgeToken?: string };
    const tok = String(parsed.bridgeToken || "").trim();
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch {
    return {};
  }
};

type CustomRuntimeRequestBody = {
  runtimeUrl?: string;
  pathname?: string;
  method?: string;
  body?: unknown;
};

const isRuntimeUrlAllowed = (runtimeUrl: string): boolean => {
  const rawAllowlist = (
    process.env.CUSTOM_RUNTIME_ALLOWLIST ||
    process.env.UPSTREAM_ALLOWLIST ||
    ""
  ).trim();
  if (!rawAllowlist) {
    return process.env.NODE_ENV !== "production";
  }
  try {
    const parsed = new URL(runtimeUrl);
    const allowed = rawAllowlist
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const hostLower = parsed.hostname.toLowerCase();
    const hostPortLower = parsed.port ? `${hostLower}:${parsed.port}` : hostLower;
    if (process.env.UNIFIED_COMPANY_GOVERNANCE === "1") {
      // Enforce exact port 3210 in governed production mode to prevent loopback SSRF to 3100/54329
      return (hostLower === "127.0.0.1" || hostLower === "localhost") && parsed.port === "3210";
    }
    return allowed.includes(hostLower) || allowed.includes(hostPortLower);
  } catch {
    return false;
  }
};

const normalizeRuntimeUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("runtimeUrl is required.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("runtimeUrl must use http, https, ws, or wss.");
  }
  parsed.username = "";
  parsed.password = "";
  const normalized = parsed.toString().replace(/\/$/, "");
  if (!isRuntimeUrlAllowed(normalized)) {
    throw new Error("runtimeUrl is not in the allowed hosts list.");
  }
  return normalized;
};

const normalizePathname = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("pathname is required.");
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const normalizeMethod = (value: unknown): "GET" | "POST" => {
  if (typeof value !== "string") return "GET";
  const upper = value.trim().toUpperCase();
  if (upper === "POST") return "POST";
  return "GET";
};

export async function POST(request: Request) {
  let payload;
  try {
    payload = (await request.json()) as CustomRuntimeRequestBody;
  } catch (error) {
    console.error("[runtime/custom] Invalid JSON request body.", error);
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  try {
    const runtimeUrl = normalizeRuntimeUrl(payload.runtimeUrl ?? "");
    const pathname = normalizePathname(payload.pathname);
    const method = normalizeMethod(payload.method);
    // Propagate the browser abort signal so that cancelling the client-side fetch
    // (e.g. hitting Stop) also cancels the upstream runtime request.
    const response = await fetch(`${runtimeUrl}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...loadServerBridgeAuthHeader(),
        ...(method === "POST" ? { "Content-Type": "application/json" } : null),
      },
      body: method === "POST" ? JSON.stringify(payload.body ?? {}) : undefined,
      cache: "no-store",
      signal: request.signal,
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom runtime proxy failed.";
    const status =
      message === "runtimeUrl is required." ||
      message === "pathname is required." ||
      message === "runtimeUrl must use http, https, ws, or wss." ||
      message === "runtimeUrl is not in the allowed hosts list."
        ? 400
        : 502;
    console.error("[runtime/custom] Proxy request failed.", error);
    return NextResponse.json(
      {
        error:
          status === 400
            ? message
            : "Custom runtime proxy failed.",
      },
      { status }
    );
  }
}

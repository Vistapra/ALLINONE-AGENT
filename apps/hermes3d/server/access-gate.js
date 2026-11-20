const crypto = require("node:crypto");


const parseCookies = (header) => {
  const raw = typeof header === "string" ? header : "";
  if (!raw.trim()) return {};
  const out = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
};

/** Constant-time string comparison to prevent timing attacks. */
const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against self to burn constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Simple in-memory rate limiter for auth attempts. */
const createRateLimiter = (maxAttempts = 10, windowMs = 60_000) => {
  const attempts = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now - entry.start > windowMs) attempts.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return {
    isLimited(ip) {
      const entry = attempts.get(ip);
      if (!entry) return false;
      return entry.count >= maxAttempts;
    },
    recordFailure(ip) {
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now - entry.start > windowMs) {
        attempts.set(ip, { count: 1, start: now });
        return;
      }
      entry.count++;
    },
    reset(ip) {
      attempts.delete(ip);
    },
  };
};

/**
 * Resolve client IP for rate limiting.
 * When TRUSTED_PROXY=1 is set, the first value of X-Forwarded-For is used.
 * Only set TRUSTED_PROXY=1 when this server sits behind a reverse proxy that
 * you control (nginx, Caddy, Vercel edge). Without it, X-Forwarded-For is
 * ignored to prevent spoofing by direct clients.
 */
const resolveClientIp = (req) => {
  if (process.env.TRUSTED_PROXY === "1") {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || "unknown";
};

function createAccessGate(options) {
  const token = String(options?.token ?? "").trim();
  const cookieName = String(options?.cookieName ?? "studio_access").trim() || "studio_access";

  const enabled = Boolean(token);
  const rateLimiter = createRateLimiter(10, 60_000);

  const getAuthState = (req) => {
    if (!enabled) return { authorized: true, limited: false };
    const ip = resolveClientIp(req);
    const cookieHeader = req.headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    const authorized = safeCompare(cookies[cookieName] || "", token);
    if (authorized) {
      rateLimiter.reset(ip);
      return { authorized: true, limited: false };
    }
    if (rateLimiter.isLimited(ip)) {
      return { authorized: false, limited: true };
    }
    rateLimiter.recordFailure(ip);
    return { authorized: false, limited: rateLimiter.isLimited(ip) };
  };

  const handleHttp = (req, res) => {
    if (!enabled) return false;
    const rawUrl = String(req.url || "/");
    const pathname = rawUrl.split("?")[0] || "/";

    // Allow public liveness probe without cookie or rate-limit penalty
    if (req.method === "GET" && pathname === "/api/health") {
      return false;
    }

    // Serve clean Owner Studio Sign-In Gate on GET /login
    if (req.method === "GET" && pathname === "/login") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Unified AI Company — Owner Sign In</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#070b12; color:#e2e8f0; font-family:system-ui,-apple-system,sans-serif; }
    .card { width:100%; max-width:420px; background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:28px; box-shadow:0 20px 50px rgba(0,0,0,.6); }
    h1 { margin:0 0 6px; font-size:16px; letter-spacing:.08em; text-transform:uppercase; color:#38bdf8; }
    p { margin:0 0 18px; font-size:13px; color:#94a3b8; line-height:1.5; }
    input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#020617; color:#f8fafc; font-family:monospace; margin-bottom:12px; }
    button { width:100%; padding:10px 14px; border:0; border-radius:8px; background:#0284c7; color:#fff; font-weight:600; cursor:pointer; }
    button:hover { background:#0369a1; }
    #err { color:#fb7185; font-size:12px; margin-top:10px; min-height:16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unified Autonomous AI Company</h1>
    <p>Enter your local Owner Studio Access Token to enter the 3D Virtual Office.</p>
    <form id="f">
      <input id="tok" type="password" placeholder="st_tok_..." autocomplete="off" required />
      <button type="submit">Authenticate &amp; Enter 3D Office</button>
      <div id="err"></div>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('err');
      errEl.textContent = '';
      const res = await fetch('/api/studio-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: document.getElementById('tok').value.trim() })
      });
      if (res.ok) {
        window.location.href = '/office';
      } else {
        const d = await res.json().catch(() => ({}));
        errEl.textContent = d.error || 'Authentication failed.';
      }
    });
  </script>
</body>
</html>`);
      return true;
    }

    // Handle Owner login submission -> HttpOnly + SameSite=Strict cookie
    if (req.method === "POST" && pathname === "/api/studio-auth/login") {
      const ip = resolveClientIp(req);
      if (rateLimiter.isLimited(ip)) {
        res.statusCode = 429;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Too many failed studio access attempts. Wait a minute and retry." }));
        return true;
      }
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size <= 8192) chunks.push(c);
      });
      req.on("end", () => {
        let candidate = "";
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          candidate = typeof parsed?.token === "string" ? parsed.token.trim() : "";
        } catch {}
        if (safeCompare(candidate, token)) {
          rateLimiter.reset(ip);
          const secureAttr = process.env.HTTPS === "true" ? "; Secure" : "";
          res.statusCode = 200;
          res.setHeader("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secureAttr}`);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } else {
          rateLimiter.recordFailure(ip);
          res.statusCode = rateLimiter.isLimited(ip) ? 429 : 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid Studio access token." }));
        }
      });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/studio-auth/logout") {
      res.statusCode = 200;
      res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    const auth = getAuthState(req);
    if (!auth.authorized) {
      const statusCode = auth.limited ? 429 : 401;
      if (rawUrl.startsWith("/api/")) {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: auth.limited
              ? "Too many failed studio access attempts. Wait a minute and retry."
              : "Studio access token required. Send the configured Studio access cookie and retry.",
          })
        );
      } else if (!auth.limited && typeof req.headers?.accept === "string" && req.headers.accept.includes("text/html")) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
      } else {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "text/plain");
        res.end(
          auth.limited
            ? "Too many failed studio access attempts. Wait a minute and retry."
            : "Studio access token required. Set the studio_access cookie to access this page."
        );
      }
      return true;
    }
    return false;
  };

  const allowUpgrade = (req) => {
    if (!enabled) return true;
    return getAuthState(req).authorized;
  };

  return { enabled, handleHttp, allowUpgrade };
}

module.exports = { createAccessGate };

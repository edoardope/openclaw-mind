import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import { resolveMindsphereUiRootSync } from "../infra/mindsphere-ui-assets.js";

const ROOT_PREFIX = "/ms";

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function applySecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function respondNotFound(res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not Found");
}

function isSafeRelativePath(relPath: string) {
  if (!relPath) {
    return false;
  }
  const normalized = path.posix.normalize(relPath);
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  if (normalized.includes("\0")) {
    return false;
  }
  return true;
}

function inject(html: string, opts: { basePath: string; assistantName: string; assistantAvatar: string }) {
  const script =
    `<script>` +
    `window.__OPENCLAW_MINDSHPERE_BASE_PATH__=${JSON.stringify(opts.basePath)};` +
    `window.__OPENCLAW_ASSISTANT_NAME__=${JSON.stringify(opts.assistantName)};` +
    `window.__OPENCLAW_ASSISTANT_AVATAR__=${JSON.stringify(opts.assistantAvatar)};` +
    `</script>`;

  if (html.includes("__OPENCLAW_ASSISTANT_NAME__")) {
    return html;
  }
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}${script}${html.slice(headClose)}`;
  }
  return `${script}${html}`;
}

function serveIndexHtml(res: ServerResponse, indexPath: string, opts: { basePath: string; config?: OpenClawConfig }) {
  const identity = opts.config ? resolveAssistantIdentity({ cfg: opts.config, agentId: "main" }) : DEFAULT_ASSISTANT_IDENTITY;
  const raw = fs.readFileSync(indexPath, "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(
    inject(raw, {
      basePath: opts.basePath,
      assistantName: identity.name,
      assistantAvatar: identity.avatar,
    }),
  );
}

export function handleMindsphereUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: { config?: OpenClawConfig },
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = new URL(urlRaw, "http://localhost");
  const pathname = url.pathname;
  if (pathname !== ROOT_PREFIX && !pathname.startsWith(`${ROOT_PREFIX}/`)) {
    return false;
  }

  const root = resolveMindsphereUiRootSync(process.argv[1]);
  if (!root) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("MindSphere UI assets missing. Build with: pnpm ui:mindsphere:build");
    return true;
  }

  applySecurityHeaders(res);

  const rel = pathname === ROOT_PREFIX ? "index.html" : pathname.slice(`${ROOT_PREFIX}/`.length);
  if (!isSafeRelativePath(rel)) {
    respondNotFound(res);
    return true;
  }

  const resolved = path.join(root, rel);
  if (!resolved.startsWith(root)) {
    respondNotFound(res);
    return true;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    respondNotFound(res);
    return true;
  }

  if (path.basename(resolved) === "index.html") {
    serveIndexHtml(res, resolved, { basePath: ROOT_PREFIX, config: opts?.config });
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeForExt(path.extname(resolved).toLowerCase()));
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(fs.readFileSync(resolved));
  return true;
}

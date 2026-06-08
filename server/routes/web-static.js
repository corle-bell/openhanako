/**
 * web-static.js — WebUI 静态文件服务路由
 *
 * 在 /web 路径下提供 SPA 前端静态文件。
 * 与 mobile-static.js 的区别：
 * - 提供 index.html（SPA 主入口）而非 mobile.html
 * - 在 index.html 中动态替换 __HANA_API_BASE_URL__ 占位符，
 *   注入实际 server 地址，使 platform.js 能正确连接到 server
 * - 所有其他静态资源（assets/、lib/、themes/ 等）直接返回
 */
import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { guessMime } from "../http/file-content.js";

const WEB_INDEX_HTML = "index.html";
const PLACEHOLDER = "__HANA_API_BASE_URL__";

export function createWebStaticRoute({ distDir, serverToken } = {}) {
  if (!distDir) throw new Error("distDir required");
  const route = new Hono();

  route.get("/web", (c) => serveWebIndex(c, distDir, serverToken));
  route.get("/web/", (c) => serveWebIndex(c, distDir, serverToken));
  route.get("/web/*", (c) => {
    const pattern = new RegExp(`^/web/?`);
    const subPath = c.req.path.replace(pattern, "");
    // 尝试匹配静态文件，失败时 fallback 到 index.html（SPA）
    const result = serveWebStaticFile(c, distDir, subPath);
    if (result) return result;
    return serveWebIndex(c, distDir, serverToken);
  });

  return route;
}

/**
 * 返回 index.html，并动态替换 __HANA_API_BASE_URL__ 占位符
 */
function serveWebIndex(c, distDir, serverToken) {
  const filePath = path.join(distDir, WEB_INDEX_HTML);
  const safePath = resolveExistingInside(distDir, filePath);
  if (!safePath) return c.body("Not Found", 404);

  let html = fs.readFileSync(safePath, "utf-8");

  // 构造实际 apiBaseUrl
  const proto = c.req.header("X-Forwarded-Proto") || "http";
  const host = c.req.header("X-Forwarded-Host") || c.req.header("Host") || "localhost";
  const apiBaseUrl = `${proto}://${host}`;

  // 替换占位符
  html = html.replace(new RegExp(escapeRegExp(PLACEHOLDER), "g"), apiBaseUrl);

  // 注入 __HANA_WEB_CONFIG__（包含 token，使前端可自动认证）
  if (serverToken) {
    const configScript = `<script>window.__HANA_WEB_CONFIG__={apiBaseUrl:${JSON.stringify(apiBaseUrl)},token:${JSON.stringify(serverToken)}};</script>`;
    html = html.replace("</head>", `${configScript}\n</head>`);
  }

  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  return c.body(html);
}

/**
 * 服务其他静态文件
 */
function serveWebStaticFile(c, distDir, requestPath) {
  const relative = safeRelativePath(requestPath);
  if (!relative) return c.body(null, 404);

  const filePath = path.join(distDir, relative);
  const safePath = resolveExistingInside(distDir, filePath);
  if (!safePath) return c.body(null, 404);

  const stat = fs.statSync(safePath);
  if (!stat.isFile()) return c.body(null, 404);

  c.header("Content-Type", guessMime(safePath));

  // index.html 不缓存（可能含占位符），其他资源长期缓存
  if (relative === WEB_INDEX_HTML) {
    c.header("Cache-Control", "no-cache");
  } else {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }

  return c.body(fs.readFileSync(safePath));
}

function safeRelativePath(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\\") || decoded.startsWith("/") || decoded.includes("\0")) return null;

  const parts = decoded.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;

  // 允许的路径前缀
  const allowedPrefixes = ["assets", "icons", "lib", "themes", "locales", "modules"];
  if (
    !allowedPrefixes.includes(parts[0])
    && decoded !== WEB_INDEX_HTML
    && decoded !== "styles.css"
    && decoded !== "animations.css"
    && decoded !== "icon.png"
  ) {
    return null;
  }

  return parts.join(path.sep);
}

function resolveExistingInside(root, target) {
  let rootReal;
  let targetReal;
  try {
    rootReal = fs.realpathSync(root);
    targetReal = fs.realpathSync(target);
  } catch {
    return null;
  }
  return targetReal === rootReal || targetReal.startsWith(rootReal + path.sep)
    ? targetReal
    : null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

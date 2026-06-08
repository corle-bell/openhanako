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
import crypto from "crypto";
import { Hono } from "hono";
import { guessMime } from "../http/file-content.js";

const WEB_INDEX_HTML = "index.html";
const PLACEHOLDER = "__HANA_API_BASE_URL__";

export function createWebStaticRoute({ distDir, serverToken } = {}) {
  if (!distDir) throw new Error("distDir required");
  const route = new Hono();

  // / 和 /web 都 serve index.html（/ 方便直接访问）
  route.get("/", (c) => serveWebIndex(c, distDir, serverToken));
  // 根路径下的静态资源（index.html 使用相对路径，由 <base href="/"> 解析到根）
  route.get("/favicon.ico", (c) => serveWebStaticFile(c, distDir, "icon.png"));
  route.get("/styles.css", (c) => serveWebStaticFile(c, distDir, "styles.css"));
  route.get("/animations.css", (c) => serveWebStaticFile(c, distDir, "animations.css"));
  route.get("/icon.png", (c) => serveWebStaticFile(c, distDir, "icon.png"));
  route.get("/assets/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  route.get("/lib/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  route.get("/modules/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  route.get("/themes/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  route.get("/locales/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  route.get("/icons/*", (c) => serveWebStaticFile(c, distDir, c.req.path.slice(1)));
  // /web/* 保留兼容（重定向到根路径的等效资源）
  route.get("/web", (c) => c.redirect("/"));
  route.get("/web/", (c) => c.redirect("/"));
  route.get("/web/*", (c) => {
    const subPath = c.req.path.replace(/^\/web\/?/, "") || "";
    if (!subPath.includes(".")) {
      return serveWebIndex(c, distDir, serverToken);
    }
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

  // 注入 <base href="/"> 确保所有相对路径从根解析
  html = html.replace("<head>", '<head>\n    <base href="/">');

  // 生成 nonce 用于 CSP
  const nonce = crypto.randomUUID();

  // 给所有内联 <script>（无 src 属性）添加 nonce，使其兼容 CSP
  // Vite 构建时 injectWebConfig 插件已注入 __HANA_WEB_CONFIG__ 脚本但没有 nonce
  html = html.replace(
    /<script(?![^>]*\ssrc=)([^>]*)>/g,
    (match, attrs) => {
      // 如果已有 nonce 属性则跳过
      if (/\snonce=/.test(match)) return match;
      return `<script nonce="${nonce}"${attrs}>`;
    }
  );

  // 注入 token 到已有的 __HANA_WEB_CONFIG__ 对象
  // Vite 构建时 injectWebConfig 插件已生成 __HANA_WEB_CONFIG__，这里只追加 token
  if (serverToken) {
    const tokenScript = `<script nonce="${nonce}">window.__HANA_WEB_CONFIG__=Object.assign(window.__HANA_WEB_CONFIG__||{},{token:${JSON.stringify(serverToken)}});</script>`;
    html = html.replace("</head>", `${tokenScript}\n</head>`);
  }

  // 修改 CSP meta tag 添加 nonce 支持
  html = html.replace(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/,
    (_, cspContent) => {
      let newCsp = cspContent;
      // 替换 script-src 以支持 nonce
      newCsp = newCsp.replace(
        /script-src\s+'self'/,
        `script-src 'self' 'nonce-${nonce}'`
      );
      // 允许内联样式（UI 主题需要）
      newCsp = newCsp.replace(
        /style-src\s+'self'/,
        `style-src 'self' 'unsafe-inline'`
      );
      return `<meta http-equiv="Content-Security-Policy" content="${newCsp}">`;
    }
  );

  c.header("Content-Type", "text/html; charset=utf-8");
  // no-store 避免浏览器缓存旧版 index.html（其中可能包含错误的 apiBaseUrl）
  c.header("Cache-Control", "no-store");
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

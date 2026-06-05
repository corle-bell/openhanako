const DEFAULT_LOOPBACK_WEB_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ELECTRON_FILE_ORIGINS = new Set(["file://", "file:///"]);

export function isCorsOriginAllowed({
  origin,
  configuredOrigin = "",
} = {}) {
  const value = String(origin || "");
  if (!value) return false;
  if (configuredOrigin) {
    // "*" 表示允许所有来源（Docker/公网部署，安全性由 token 鉴权保证）
    if (configuredOrigin === "*") return true;
    return value === configuredOrigin;
  }
  if (value === "null") return true;
  if (ELECTRON_FILE_ORIGINS.has(value)) return true;
  return DEFAULT_LOOPBACK_WEB_ORIGIN.test(value);
}

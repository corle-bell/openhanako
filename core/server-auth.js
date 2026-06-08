import { authenticateDeviceCredential } from "./device-registry.js";
import { normalizePrincipal } from "./security-principal.js";
import { authenticateWebSession } from "./web-session-store.js";

export function createServerAuthService({
  hanakoHome,
  loopbackToken,
  runtimeContext,
}) {
  if (!hanakoHome) throw new Error("hanakoHome required");
  if (!isNonEmptyString(loopbackToken)) throw new Error("loopbackToken required");

  function resolveRuntimeContext() {
    return typeof runtimeContext === "function" ? runtimeContext() : runtimeContext;
  }

  function authenticateRequest({
    authorization = null,
    queryToken = null,
    cookieHeader = null,
    allowQueryToken = false,
    connectionKind = "local",
    now,
  } = {}) {
    return authenticateRequestDetailed({
      authorization,
      queryToken,
      cookieHeader,
      allowQueryToken,
      connectionKind,
      now,
    }).principal;
  }

  function authenticateRequestDetailed({
    authorization = null,
    queryToken = null,
    cookieHeader = null,
    allowQueryToken = false,
    connectionKind = "local",
    now,
  } = {}) {
    const parsed = parseCredential({ authorization, queryToken, allowQueryToken, connectionKind });
    if (!parsed) {
      const webPrincipal = authenticateWebSession(hanakoHome, cookieHeader, { now });
      if (!webPrincipal) {
        return denyAuth("missing_credential", { connectionKind });
      }
      if (!principalAllowsConnection(webPrincipal, connectionKind)) {
        return denyAuth("connection_not_allowed", {
          credentialSource: "cookie",
          connectionKind,
        });
      }
      return allowAuth(normalizePrincipal({
        ...webPrincipal,
        connectionKind: connectionKind === "local"
          ? (webPrincipal.connectionKind || connectionKind)
          : connectionKind,
      }));
    }

    if (parsed.token === loopbackToken) {
      // Loopback token 在 local 和 lan 模式下都可用；
      // lan 模式用于 Docker/局域网部署（token 通过 __HANA_WEB_CONFIG__ 安全注入到页面 HTML）
      if (connectionKind === "local" || connectionKind === "lan") {
        return allowAuth(createLocalPrincipal(resolveRuntimeContext()));
      }
      // 非 local/lan 模式（如 custom_remote），fallback 到 cookie
      const webPrincipal = authenticateWebSession(hanakoHome, cookieHeader, { now });
      if (!webPrincipal) {
        return denyAuth("loopback_token_requires_local_transport", {
          credentialSource: parsed.source,
          connectionKind,
        });
      }
      if (!principalAllowsConnection(webPrincipal, connectionKind)) {
        return denyAuth("connection_not_allowed", {
          credentialSource: "cookie",
          connectionKind,
        });
      }
      return allowAuth(normalizePrincipal({
        ...webPrincipal,
        connectionKind,
      }));
    }

    const devicePrincipal = authenticateDeviceCredential(hanakoHome, parsed.token, { now });
    if (!devicePrincipal) {
      // Device credential 无效时，fallback 到 cookie
      const webPrincipal = authenticateWebSession(hanakoHome, cookieHeader, { now });
      if (!webPrincipal) {
        return denyAuth("invalid_credential", {
          credentialSource: parsed.source,
          connectionKind,
        });
      }
      if (!principalAllowsConnection(webPrincipal, connectionKind)) {
        return denyAuth("connection_not_allowed", {
          credentialSource: "cookie",
          connectionKind,
        });
      }
      return allowAuth(normalizePrincipal({
        ...webPrincipal,
        connectionKind: connectionKind === "local"
          ? (webPrincipal.connectionKind || connectionKind)
          : connectionKind,
      }));
    }
    if (!principalAllowsConnection(devicePrincipal, connectionKind)) {
      return denyAuth("connection_not_allowed", {
        credentialSource: parsed.source,
        connectionKind,
      });
    }
    return allowAuth(normalizePrincipal({
      ...devicePrincipal,
      connectionKind: connectionKind === "local" ? devicePrincipal.connectionKind : connectionKind,
    }));
  }

  function authenticateToken(token, options = {}) {
    return authenticateRequest({
      ...options,
      authorization: token ? `Bearer ${token}` : null,
    });
  }

  return Object.freeze({
    authenticateRequest,
    authenticateRequestDetailed,
    authenticateToken,
  });
}

export function parseBearerAuthorization(authorization) {
  if (!isNonEmptyString(authorization)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}

function parseCredential({ authorization, queryToken, allowQueryToken, connectionKind }) {
  const bearer = parseBearerAuthorization(authorization);
  if (bearer) return { token: bearer, source: "authorization" };
  if (!allowQueryToken || !isNonEmptyString(queryToken)) return null;
  if (connectionKind !== "local") return null;
  return { token: queryToken.trim(), source: "query" };
}

function createLocalPrincipal(runtimeContext) {
  return normalizePrincipal({
    kind: "local_user",
    credentialKind: "loopback_token",
    connectionKind: "local",
    trustState: "local",
    serverId: runtimeContext?.serverId ?? null,
    serverNodeId: runtimeContext?.serverNodeId ?? runtimeContext?.serverId ?? null,
    userId: runtimeContext?.userId ?? null,
    studioId: runtimeContext?.studioId ?? null,
    platformAccountId: runtimeContext?.platformAccountId ?? null,
    officialServiceKind: runtimeContext?.officialServiceKind ?? null,
    scopes: Array.isArray(runtimeContext?.capabilities) ? [...runtimeContext.capabilities] : ["chat", "resources", "tools"],
  });
}

function principalAllowsConnection(principal, connectionKind) {
  if (!principal) return false;
  // local_user 允许 local 和 lan 连接（通过 web-auth/login 获取 session 后可跨网络使用）
  if (principal.kind === "local_user") return connectionKind === "local" || connectionKind === "lan";
  if (principal.kind !== "device") return true;
  if (connectionKind === "local") return true;
  if (principal.trustState === "tunnel") return connectionKind === "custom_remote";
  return connectionKind === "lan";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function allowAuth(principal) {
  return Object.freeze({ principal, denied: null });
}

function denyAuth(reason, details = {}) {
  return Object.freeze({
    principal: null,
    denied: Object.freeze({
      error: "forbidden",
      reason,
      ...details,
    }),
  });
}

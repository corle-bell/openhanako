/**
 * web-router.ts — Web 环境 hash-based 路由
 *
 * 在 Web SPA 环境中，所有"窗口"合并为单一页面，通过 URL hash 区分：
 *
 *   #/chat          → 主聊天窗口（默认）
 *   #/settings      → 设置面板
 *   #/quick-chat    → 快捷聊天
 *   #/onboarding    → 引导流程
 *   #/browser       → 内嵌浏览器查看器
 *   #/viewer        → 文件查看器（派生窗口替代）
 *
 * 不使用 react-router-dom，而是基于 window.location.hash 的简单发布-订阅模式。
 * 组件通过 useWebRoute() hook 订阅路由变化。
 */

import { useState, useEffect } from 'react';

export type WebRoute =
  | 'chat'
  | 'settings'
  | 'quick-chat'
  | 'onboarding'
  | 'browser'
  | 'viewer';

const ROUTE_REGEX = /^#\/(chat|settings|quick-chat|onboarding|browser|viewer)(\?.*)?$/;

type RouteListener = (route: WebRoute, params: URLSearchParams) => void;
const listeners = new Set<RouteListener>();

let _currentRoute: WebRoute = 'chat';
let _currentParams: URLSearchParams = new URLSearchParams();

function parseHash(hash: string): { route: WebRoute; params: URLSearchParams } | null {
  const match = hash.match(ROUTE_REGEX);
  if (!match) return null;
  const route = match[1] as WebRoute;
  const queryString = match[2] || '';
  const params = new URLSearchParams(queryString);
  return { route, params };
}

function handleHashChange(): void {
  const hash = window.location.hash || '#/chat';
  const parsed = parseHash(hash);
  if (!parsed) {
    // 无效路由，回退到 chat
    navigateTo('chat');
    return;
  }
  _currentRoute = parsed.route;
  _currentParams = parsed.params;
  for (const listener of listeners) {
    listener(_currentRoute, _currentParams);
  }
}

// 初始化
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', handleHashChange);
  // 首次加载
  handleHashChange();
}

export function getCurrentRoute(): WebRoute {
  return _currentRoute;
}

export function getCurrentParams(): URLSearchParams {
  return _currentParams;
}

export function navigateTo(route: WebRoute, params?: Record<string, string>): void {
  let hash = `#/${route}`;
  if (params && Object.keys(params).length > 0) {
    const search = new URLSearchParams(params).toString();
    hash += `?${search}`;
  }
  window.location.hash = hash;
}

export function subscribeToRoute(listener: RouteListener): () => void {
  listeners.add(listener);
  // 立即通知当前路由
  listener(_currentRoute, _currentParams);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook：订阅 Web 路由变化
 */
export function useWebRoute(): { route: WebRoute; params: URLSearchParams } {
  const [state, setState] = useState<{ route: WebRoute; params: URLSearchParams }>(() => ({
    route: _currentRoute,
    params: _currentParams,
  }));

  useEffect(() => {
    const unsub = subscribeToRoute((route, params) => {
      setState({ route, params });
    });
    return unsub;
  }, []);

  return state;
}

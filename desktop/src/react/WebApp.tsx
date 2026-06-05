/**
 * WebApp.tsx — Web SPA 根组件
 *
 * 核心设计：
 * - App（主窗口）始终挂载，维持 Zustand store 和 WebSocket 连接
 * - 其他路由作为 overlay 渲染在 App 之上
 * - Settings 通过 SettingsModalShell（已在 App 内）打开
 * - Quick Chat / Onboarding / Browser / Viewer 作为全屏 overlay
 *
 * 路由表：
 *   #/chat        → 仅 App（默认）
 *   #/settings    → App + 自动打开 SettingsModalShell
 *   #/quick-chat  → App + QuickChatApp overlay
 *   #/onboarding  → OnboardingApp（替换 App，首次启动）
 *   #/browser     → App + BrowserViewer overlay
 *   #/viewer      → App + ViewerApp overlay
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useWebRoute, navigateTo } from './services/web-router';
import { initTheme, initDragPrevention } from './bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStore } from './stores';
import { openSettingsModal } from './stores/settings-modal-actions';

// 立即执行 bootstrap
initTheme();
initDragPrevention();

// 主窗口 App（始终渲染）
import App from './App';

// Lazy load overlay 组件
const QuickChatApp = lazy(() =>
  import('./quick-chat/QuickChatApp').then((m) => ({ default: m.QuickChatApp }))
);
const OnboardingApp = lazy(() =>
  import('./onboarding/OnboardingApp').then((m) => ({ default: m.OnboardingApp }))
);
const ViewerApp = lazy(() =>
  import('../viewer-window-entry').then((m) => ({ default: m.ViewerApp }))
);


function RouteFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--surface-primary, #fff)',
        color: 'var(--text-muted)',
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}

/**
 * Quick Chat overlay
 */
function QuickChatOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--surface-primary, #fff)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '8px 16px',
          background: 'var(--surface-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          onClick={() => navigateTo('chat')}
          style={{
            background: 'var(--surface-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontSize: 13,
          }}
        >
          ← 返回聊天
        </button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>快捷聊天</span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Suspense fallback={<RouteFallback />}>
          <QuickChatApp />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Browser Viewer overlay（iframe）
 */
function BrowserOverlay({ params }: { params: URLSearchParams }) {
  const url = params.get('url') || 'about:blank';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--surface-primary, #fff)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '8px 16px',
          background: 'var(--surface-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        <button
          onClick={() => navigateTo('chat')}
          style={{
            background: 'var(--surface-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontSize: 13,
          }}
        >
          ← 返回
        </button>
        <span
          style={{
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {url}
        </span>
      </div>
      <iframe
        src={url}
        style={{ flex: 1, border: 'none', width: '100%' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Browser Viewer"
      />
    </div>
  );
}

/**
 * Viewer overlay
 */
function ViewerOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--surface-primary, #fff)',
      }}
    >
      <Suspense fallback={<RouteFallback />}>
        <ViewerApp />
      </Suspense>
    </div>
  );
}

export function WebApp() {
  const { route, params } = useWebRoute();
  const [appReady, setAppReady] = useState(false);

  // 监听 initApp 完成状态
  const connected = useStore((s) => s.connected);
  const serverPort = useStore((s) => s.serverPort);

  useEffect(() => {
    if (connected || serverPort) {
      setAppReady(true);
    }
  }, [connected, serverPort]);

  // Settings 路由：自动打开 modal
  useEffect(() => {
    if (route === 'settings') {
      const tab = params.get('tab') || undefined;
      // 等待 App 初始化完成后再打开 settings modal
      if (appReady) {
        openSettingsModal(tab);
        // 回到 chat 路由（settings 作为 modal 显示）
        navigateTo('chat');
      }
    }
  }, [route, params, appReady]);

  // Onboarding 路由：替换 App
  if (route === 'onboarding') {
    const preview = params.has('preview');
    const skipToTutorial = params.has('skipToTutorial');
    return (
      <ErrorBoundary region="web-onboarding">
        <Suspense fallback={<RouteFallback />}>
          <OnboardingApp preview={preview} skipToTutorial={skipToTutorial} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // 默认：渲染 App + 可选 overlay
  // settings 路由且未 ready：显示 loading（避免短暂闪烁 App 再弹 modal）
  if (route === 'settings' && !appReady) {
    return <RouteFallback />;
  }

  return (
    <ErrorBoundary region="web-root">
      <App />

      {route === 'quick-chat' && <QuickChatOverlay />}

      {route === 'browser' && <BrowserOverlay params={params} />}

      {route === 'viewer' && <ViewerOverlay />}
    </ErrorBoundary>
  );
}

export default WebApp;

/**
 * web-main.tsx — Web SPA 统一入口
 *
 * 与 main.tsx（Electron 主窗口入口）平行。
 * 此文件只在 vite.config.web.ts 构建中使用，挂载 WebApp 路由分发器。
 */
import { createRoot } from 'react-dom/client';
import { WebApp } from './react/WebApp';

function markLaunch(event: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[hana-launch-web] ${event}`);
  } else {
    console.info(`[hana-launch-web] ${event}`, details);
  }
}

markLaunch('renderer-entry');

window.addEventListener('securitypolicyviolation', (event) => {
  markLaunch('securitypolicyviolation', JSON.stringify({
    blockedURI: event.blockedURI,
    violatedDirective: event.violatedDirective,
    effectiveDirective: event.effectiveDirective,
    disposition: event.disposition,
  }));
});

const el = document.getElementById('react-root');
if (el) {
  markLaunch('root-mount-start');
  createRoot(el).render(<WebApp />);
  markLaunch('root-mounted');
} else {
  markLaunch('react-root-missing');
}

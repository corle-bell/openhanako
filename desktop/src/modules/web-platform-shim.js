/**
 * web-platform-shim.js — Web 环境 platform API shim
 *
 * 在 Electron 中，window.platform 和 window.hana 由 preload.cjs 通过 contextBridge 注入。
 * 在 Web SPA 环境中，没有 preload，此 shim 提供兼容的 API 实现：
 *
 *   - getServerPort / getServerToken → 从 __HANA_WEB_CONFIG__ 读取
 *   - appReady / onServerRestarted → 无操作（Web 不需要通知主进程）
 *   - onSettingsChanged / onOpenSettingsModal / onQuickChatOpenSession → 通过 CustomEvent 模拟
 *   - openSettings / openBrowserViewer / spawnViewer → 通过 URL hash 路由模拟
 *   - readFile / writeFile / selectFolder → 通过 HTTP API 代理
 *
 * 此文件在 index.html 中 platform.js 之后加载（覆盖 window.platform）。
 */

(function installWebPlatformShim() {
  'use strict';

  // 仅在 Web 环境（无 window.hana）时安装
  if (window.hana) return;

  const config = window.__HANA_WEB_CONFIG__ || {};

  /**
   * 通过 HTTP API 读取文件内容
   */
  async function httpReadFile(filePath) {
    try {
      const res = await fetch('/api/desk/file/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.content ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 通过 HTTP API 写入文件
   */
  async function httpWriteFile(filePath, content) {
    const res = await fetch('/api/desk/file/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
      credentials: 'include',
    });
    return res.ok;
  }

  /**
   * CustomEvent 辅助：模拟 IPC 事件
   */
  function emitIpcEvent(name, data) {
    window.dispatchEvent(new CustomEvent('hana-ipc:' + name, { detail: data }));
  }

  function onIpcEvent(name, callback) {
    const handler = function (e) { callback(e.detail); };
    window.addEventListener('hana-ipc:' + name, handler);
    return function () { window.removeEventListener('hana-ipc:' + name, handler); };
  }

  /**
   * Hash 路由辅助
   */
  function navigateToHash(route, params) {
    var hash = '#/' + route;
    if (params) {
      var pairs = [];
      for (var k in params) {
        if (params.hasOwnProperty(k)) {
          pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      if (pairs.length) hash += '?' + pairs.join('&');
    }
    window.location.hash = hash;
  }

  // ── window.platform shim ──

  window.platform = {
    // 核心信息
    getServerPort: function () {
      return Promise.resolve(String(config.serverPort || window.location.port || ''));
    },
    getServerToken: function () {
      var token = config.token || localStorage.getItem('hana-token') || '';
      return Promise.resolve(token);
    },

    // 生命周期（Web 无主进程，空操作）
    appReady: function () {
      console.info('[web-shim] appReady (no-op in web)');
    },

    // Server 重启（Web 环境 Server 重启会导致页面刷新，通过 WebSocket 重连处理）
    onServerRestarted: function (callback) {
      // Web 环境：监听 WS 重连后的事件
      return onIpcEvent('server-restarted', callback);
    },

    // 设置变更（Web 环境通过 CustomEvent 在主窗口内传播）
    onSettingsChanged: function (callback) {
      return onIpcEvent('settings-changed', callback);
    },
    settingsChanged: function (type, data) {
      emitIpcEvent('settings-changed', { type: type, data: data });
    },

    // 设置模态框（Web 环境：跳转到 settings 路由）
    onOpenSettingsModal: function (callback) {
      return onIpcEvent('open-settings-modal', callback);
    },
    openSettings: function (tab) {
      var hash = '#/settings';
      if (tab) hash += '?tab=' + encodeURIComponent(tab);
      window.location.hash = hash;
    },

    // Quick Chat（Web 环境：跳转到 quick-chat 路由）
    onQuickChatOpenSession: function (callback) {
      return onIpcEvent('quick-chat-open-session', callback);
    },

    // Browser Viewer（Web 环境：跳转到 browser 路由）
    openBrowserViewer: function (url) {
      navigateToHash('browser', { url: url });
    },

    // Viewer（Web 环境：跳转到 viewer 路由）
    onViewerLoad: function (callback) {
      // Web 环境：从 URL hash 参数解析
      function parseAndNotify() {
        var hash = window.location.hash;
        var qIndex = hash.indexOf('?');
        if (qIndex < 0) return;
        var params = new URLSearchParams(hash.slice(qIndex + 1));
        if (params.has('filePath')) {
          callback({
            filePath: params.get('filePath') || '',
            title: params.get('title') || '',
            type: params.get('type') || 'code',
            language: params.get('language') || null,
            windowId: 0,
          });
        }
      }
      parseAndNotify();
      window.addEventListener('hashchange', parseAndNotify);
      return function () { window.removeEventListener('hashchange', parseAndNotify); };
    },
    viewerClose: function () {
      navigateToHash('chat');
    },

    // 文件操作（通过 HTTP API）
    readFile: function (filePath) {
      return httpReadFile(filePath);
    },
    writeFile: function (filePath, content) {
      return httpWriteFile(filePath, content);
    },

    // 文件选择（Web 环境：使用浏览器 <input type="file">）
    selectFolder: function () {
      return new Promise(function (resolve) {
        // Web 环境无法选择文件夹，返回 null
        resolve(null);
      });
    },
    selectFiles: function () {
      return new Promise(function (resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = function () {
          var files = Array.from(input.files || []).map(function (f) { return f.name; });
          resolve(files);
        };
        input.oncancel = function () { resolve(null); };
        input.click();
      });
    },

    // 打开外部链接
    openExternal: function (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    // 获取应用版本（Web 环境无版本号）
    getAppVersion: function () {
      return Promise.resolve('web');
    },

    // 获取平台
    getPlatform: function () {
      return Promise.resolve('web');
    },

    // 窗口控制（Web 环境无窗口控制）
    windowMinimize: function () {},
    windowMaximize: function () {},
    windowClose: function () {},

    // 通知
    showNotification: function (title, body) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: body });
      }
    },

    // 开机自启 / 防休眠（Web 环境不支持）
    getAutoLaunchStatus: function () { return Promise.resolve(false); },
    setAutoLaunchEnabled: function () {},
    getKeepAwakeStatus: function () { return Promise.resolve(false); },
    setKeepAwakeEnabled: function () {},

    // 文件快照 / CAS 写入（Web 环境不支持）
    readFileSnapshot: function () { return Promise.resolve(null); },
    writeFileIfUnchanged: function () { return Promise.resolve(false); },
    writeFileBinary: function () { return Promise.resolve(false); },
    copyFile: function () { return Promise.resolve(false); },

    // 拖拽 / 回收站 / 截图 / DOCX / XLSX（Web 环境不支持）
    startDrag: function () {},
    trashItem: function () { return Promise.resolve(false); },
    openFolder: function () {},
    openFile: function () {},
    showInFinder: function () {},
    screenshotRender: function () { return Promise.resolve(null); },
    readFileBase64: function () { return Promise.resolve(null); },
    readDocxHtml: function () { return Promise.resolve(null); },
    readXlsxHtml: function () { return Promise.resolve(null); },
    getAvatarPath: function () { return Promise.resolve(null); },
    getSplashInfo: function () { return Promise.resolve({}); },
    reloadMainWindow: function () { window.location.reload(); },

    // 更新相关（Web 环境不支持）
    checkUpdate: function () { return Promise.resolve(null); },
    autoUpdateCheck: function () {},
    autoUpdateDownload: function () {},
    autoUpdateInstall: function () {},
    autoUpdateState: function () {},
    autoUpdateSetChannel: function () {},

    // 快捷键 / 命令
    runEditCommand: function () {},
    quickChatReloadShortcut: function () {},
    quickChatShortcutStatus: function () { return Promise.resolve(false); },
    quickChatShow: function () { navigateToHash('quick-chat'); },
    quickChatHide: function () { navigateToHash('chat'); },
    quickChatResize: function () {},
    quickChatOpenSession: function (payload) {
      emitIpcEvent('quick-chat-open-session', payload);
    },

    // 文件监听（Web 环境不支持，返回 Promise<boolean> 保持与 Electron API 兼容）
    watchFile: function () { return Promise.resolve(false); },
    unwatchFile: function () { return Promise.resolve(false); },
    watchWorkspace: function () { return Promise.resolve(false); },
    unwatchWorkspace: function () { return Promise.resolve(false); },

    // 其他
    debugOpenOnboarding: function () { navigateToHash('onboarding'); },
    debugOpenOnboardingPreview: function () { navigateToHash('onboarding', { preview: '1' }); },
    closeBrowserViewer: function () { navigateToHash('chat'); },
    browserGoBack: function () {},
    browserGoForward: function () {},
    browserReload: function () {},
    browserEmergencyStop: function () {},
    spawnViewer: function (data) {
      // Web 环境：跳转到 viewer 路由，通过 URL 参数传递文件信息
      if (data && data.filePath) {
        navigateToHash('viewer', {
          filePath: data.filePath,
          title: data.title || '',
          type: data.type || 'code',
          language: data.language || '',
        });
      }
      return Promise.resolve(0);
    },
    viewerClose: function () {},
    onViewerClosed: function (callback) {
      // Web 环境：viewer 关闭时（hash 回到 chat），通知主窗口清理 store
      return onIpcEvent('viewer-closed', function (data) {
        callback(data.windowId || 0);
      });
    },
    openSkillViewer: function () {},
    skillViewerListFiles: function () { return Promise.resolve([]); },
    skillViewerReadFile: function () { return Promise.resolve(null); },
    closeSkillViewer: function () {},
    selectSkill: function () { return Promise.resolve(null); },
    selectPlugin: function () { return Promise.resolve(null); },

    // 兼容方法
    isMaximized: function () { return Promise.resolve(false); },
    onboardingComplete: function () { navigateToHash('chat'); },
  };

  // ── data-platform 标记（供 link-open.ts 等检测 Web 环境） ──
  document.documentElement.setAttribute('data-platform', 'web');

  // ── window.hana shim（Electron preload 暴露的 API） ──
  // Web 环境没有 window.hana，相关功能由 platform shim 提供

  console.info('[web-shim] Web platform shim installed');
})();

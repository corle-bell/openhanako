/**
 * vite.config.web.ts — Web 环境构建配置
 *
 * 与 vite.config.ts 的区别：
 * - 只构建 index.html（SPA 主入口），不构建多窗口 HTML
 * - CSP 策略适配公网部署（允许任意 connect-src，安全由 token 鉴权保证）
 * - 注入 window.__HANA_WEB_CONFIG__ 供 platform.js Web fallback 使用
 * - 产出到 dist-web/ 目录
 * - 开发模式自动启动 Hana server 并配置代理
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { homedir } from 'os';

const CSP_WEB =
  "default-src 'self'; " +
  "connect-src 'self' ws: wss: http: https:; " +
  "img-src 'self' data: blob: http: https:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; " +
  "font-src 'self' data:; " +
  "frame-src blob: data: http: https:;";

const DEV_HANA_HOME = path.join(homedir(), '.hanako-dev');
const SERVER_INFO_PATH = path.join(DEV_HANA_HOME, 'server-info.json');
const ROOT_DIR = path.resolve(__dirname);

let serverProcess: ChildProcess | null = null;
let devServerPort = 0;
let devServerToken = '';

/**
 * 开发模式自动启动 Hana server 的 Vite 插件
 * - 启动 server (node server/index.js)
 * - 等待 server-info.json 写入（含 token + port）
 * - 将 token 注入到 HTML 中供 platform.js 使用
 */
function autoStartServer(): Plugin {
  return {
    name: 'hana-web-auto-start-server',
    apply: 'serve', // 仅开发模式
    async config(userConfig, env) {
      // 如果跳过自动启动或非开发模式，不处理
      if (process.env.HANA_SKIP_AUTO_SERVER === '1') return;
      if (env.command !== 'serve') return;

      const serverEntry = path.join(ROOT_DIR, 'server', 'index.js');

      // 清理旧的 server-info.json
      try { fs.unlinkSync(SERVER_INFO_PATH); } catch {}

      // 启动 server
      fs.mkdirSync(DEV_HANA_HOME, { recursive: true });
      serverProcess = spawn(process.execPath, [serverEntry], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          HANA_HOME: DEV_HANA_HOME,
          HANA_CREATE_STARTUP_SESSION: '0',
          HANA_PORT: '3650',
        },
        stdio: 'inherit',
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[hana-web] server exited (${signal || code})`);
        serverProcess = null;
      });

      // 等待 server-info.json（最多 90 秒）
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
          throw new Error('Hana server exited prematurely');
        }
        try {
          const raw = fs.readFileSync(SERVER_INFO_PATH, 'utf-8');
          const info = JSON.parse(raw);
          devServerPort = info.port;
          devServerToken = info.token;
          console.log(`[hana-web] server ready on port ${devServerPort}`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      if (!devServerPort) {
        throw new Error('Timed out waiting for Hana server to start');
      }

      // 返回合并的配置：设置 API 代理到 server 实际端口
      return {
        server: {
          proxy: {
            '/api': {
              target: `http://127.0.0.1:${devServerPort}`,
              changeOrigin: true,
            },
          },
        },
      };
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!devServerToken) return html;

        // 注入 __HANA_DEV_WEB__ 配置（含 token），platform.js 会读取
        const payload = JSON.stringify({
          serverPort: String(devServerPort || 3650),
          apiBaseUrl: '',
        }).replace(/</g, '\\u003c');

        // 也注入 token 到 localStorage 备用
        const tokenScript = `<script>
window.__HANA_DEV_WEB__=${payload};
try { localStorage.setItem('hana-token', '${devServerToken}'); } catch(e) {}
</script>`;

        return html.replace('</head>', `${tokenScript}\n</head>`);
      },
    },
    closeBundle() {
      if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
      }
    },
  };
}

/**
 * 注入 CSP meta tag
 */
function injectCsp(): Plugin {
  return {
    name: 'hana-web-inject-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let csp = CSP_WEB;
        // Dev 模式放宽
        if (process.env.NODE_ENV !== 'production') {
          csp = csp.replace(
            /script-src 'self'/,
            "script-src 'self' 'unsafe-inline'",
          );
        }
        return html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>/,
          `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        );
      },
    },
  };
}

/**
 * 注入 Web 环境配置：apiBaseUrl + token
 * 构建时为空占位，运行时由 Server 动态替换（见 server/routes/web-static.js）
 * 或通过环境变量 HANA_WEB_API_BASE_URL 在构建时注入
 */
function injectWebConfig(): Plugin {
  return {
    name: 'hana-web-inject-config',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const apiBaseUrl = process.env.HANA_WEB_API_BASE_URL?.trim() || '';
        const payload = JSON.stringify({
          apiBaseUrl: apiBaseUrl || '__HANA_API_BASE_URL__',
          serverPort: '',
        }).replace(/</g, '\\u003c');
        return html.replace(
          '</head>',
          `<script>window.__HANA_WEB_CONFIG__=${payload};</script>\n</head>`,
        );
      },
    },
  };
}

/**
 * 保留旧 CSS link 标签（同 vite.config.ts）
 */
function preserveLegacyCss(): Plugin {
  return {
    name: 'hana-web-preserve-legacy-css',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(
          /<link\s+rel="stylesheet"\s+href="([^"]+)"([^>]*)>/g,
          (_match, href, rest) => `<!--HANA_CSS:${href}${rest}-->`
        );
      },
    },
  };
}

function restoreLegacyCss(): Plugin {
  return {
    name: 'hana-web-restore-legacy-css',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          /<!--HANA_CSS:(.*?)-->/g,
          (_match, content) => {
            const parts = content.split(/\s+/);
            const href = parts[0];
            const rest = parts.slice(1).join(' ');
            return `<link rel="stylesheet" href="${href}"${rest ? ' ' + rest : ''}>`;
          }
        );
      },
    },
  };
}

/**
 * 复制旧文件到 dist-web/
 */
function copyLegacyFiles(): Plugin {
  return {
    name: 'hana-web-copy-legacy-files',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'desktop/src');
      const outDir = path.resolve(__dirname, 'dist-web');

      const dirs = ['lib', 'modules', 'themes', 'assets', 'locales'];
      const files = ['styles.css', 'animations.css', 'icon.png'];

      for (const dir of dirs) {
        const src = path.join(srcDir, dir);
        const dest = path.join(outDir, dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      for (const file of files) {
        const src = path.join(srcDir, file);
        const dest = path.join(outDir, file);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest);
        }
      }
    },
  };
}

/**
 * 替换 main.tsx → web-main.tsx + 注入 web-platform-shim.js
 * Web 环境无 Electron preload，需要 shim 提供 window.platform API
 */
function useWebEntry(): Plugin {
  return {
    name: 'hana-web-use-web-entry',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // 替换入口为 web-main.tsx
        html = html.replace(
          /<script\s+type="module"\s+src="\.\/main\.tsx"><\/script>/,
          '<script type="module" src="./web-main.tsx"></script>',
        );
        // 注入 web-platform-shim.js（在 platform.js 之后）
        html = html.replace(
          /<script\s+src="modules\/platform\.js"><\/script>/,
          '<script src="modules/platform.js"></script>\n    <script src="modules/web-platform-shim.js"></script>',
        );
        return html;
      },
    },
  };
}

/**
 * 将 shared/*.cjs 文件转为 ESM 兼容格式
 * - module.exports = {...} → export default {...}
 * - require('node:xxx') → import (Vite 会处理 browser polyfill)
 */
function transformCjsToEsm(): Plugin {
  const CJS_MODULE_RE = /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  const CJS_EXPORTS_RE = /module\.exports\s*=\s*\{/;

  return {
    name: 'hana-web-cjs-to-esm',
    enforce: 'pre',
    async transform(code, id) {
      // 只处理 shared/ 目录下的 .cjs 文件
      if (!id.includes('shared') || !id.endsWith('.cjs')) return null;

      let result = code;

      // require() → import
      const imports: string[] = [];
      result = result.replace(CJS_MODULE_RE, (_, varName, modPath) => {
        // node built-in modules → Vite will polyfill
        const importName = modPath.startsWith('node:') ? modPath.slice(5) : modPath;
        imports.push(`import ${varName} from '${importName}';`);
        return `// require → import: ${varName}`;
      });

      // module.exports = {...} → export default {...}
      result = result.replace(CJS_EXPORTS_RE, 'export default {');

      // 删除多余的 module.exports 相关代码（如果还有）
      result = result.replace(/module\.exports/g, '// module.exports');

      // 在文件顶部添加 import 语句
      if (imports.length > 0) {
        result = imports.join('\n') + '\n' + result;
      }

      return { code: result, map: null };
    },
  };
}

export default defineConfig({
  root: 'desktop/src',
  base: './',
  plugins: [
    autoStartServer(),
    transformCjsToEsm(),
    preserveLegacyCss(),
    react(),
    injectCsp(),
    injectWebConfig(),
    useWebEntry(),
    restoreLegacyCss(),
    copyLegacyFiles(),
  ],
  resolve: {
    alias: {
      '@hana/plugin-protocol': path.resolve(__dirname, 'packages/plugin-protocol/src/index.ts'),
      '@hana/plugin-sdk': path.resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
      '@hana/plugin-runtime': path.resolve(__dirname, 'packages/plugin-runtime/src/index.ts'),
      '@hana/plugin-components': path.resolve(__dirname, 'packages/plugin-components/src/index.ts'),
      '@': path.resolve(__dirname, 'desktop/src/react'),
    },
  },
  css: {
    modules: {
      generateScopedName(name: string, filename: string): string {
        if (name.startsWith('hana-')) return name;
        const hash = crypto.createHash('md5').update(filename + '|' + name).digest('hex').slice(0, 5);
        return `_${name}_${hash}`;
      },
    },
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'desktop/src/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // /api 代理由 autoStartServer 插件在 config hook 中动态配置
    // /ws 代理转发 WebSocket 连接到 Hana server
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3650',
        ws: true,
      },
    },
  },
});

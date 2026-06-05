/**
 * theme.js — 主题系统（非模块脚本，在 React 挂载前执行）
 *
 * 由 index.html 通过 <script src="lib/theme.js"> 加载。
 * 设置 CSS 变量和 themeSheet href，同时暴露 window.setTheme / window.applyTheme 等。
 *
 * 主题数据内联自 theme-registry-data.json，避免依赖 ESM 模块系统。
 */
(function () {
  'use strict';

  // ── 主题注册表（内联自 theme-registry-data.json） ──
  var STORAGE_KEY = 'hana-theme';
  var DEFAULT_THEME = 'warm-paper';
  var AUTO_LIGHT_DEFAULT = 'warm-paper';
  var AUTO_DARK_DEFAULT = 'midnight';
  var LEGACY_ALIASES = { 'claude-design': 'new-warm-paper' };

  var THEMES = {
    'warm-paper':        { cssPath: 'themes/warm-paper.css',        backgroundColor: '#F8F5ED' },
    'midnight':          { cssPath: 'themes/midnight.css',          backgroundColor: '#3B4A54' },
    'high-contrast':     { cssPath: 'themes/high-contrast.css',     backgroundColor: '#FAF9F6' },
    'grass-aroma':       { cssPath: 'themes/grass-aroma.css',       backgroundColor: '#F5F8F3' },
    'contemplation':     { cssPath: 'themes/contemplation.css',     backgroundColor: '#F3F5F7' },
    'absolutely':        { cssPath: 'themes/absolutely.css',        backgroundColor: '#F4F3EE' },
    'delve':             { cssPath: 'themes/delve.css',             backgroundColor: '#FFFFFF' },
    'deep-think':        { cssPath: 'themes/deep-think.css',        backgroundColor: '#FCFCFD' },
    'new-warm-paper':    { cssPath: 'themes/new-warm-paper.css',    backgroundColor: '#F5EFE4' },
    'midnight-contrast': { cssPath: 'themes/midnight-contrast.css', backgroundColor: '#26343D' }
  };

  var PAPER_TEXTURE_BLOCKED = ['midnight', 'midnight-contrast'];

  var themeSheet = document.getElementById('themeSheet');

  // ── helpers ──
  function systemIsDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function migrateSaved(raw) {
    if (raw === 'auto') return 'auto';
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_THEME;
    if (LEGACY_ALIASES[raw]) return LEGACY_ALIASES[raw];
    return raw in THEMES ? raw : DEFAULT_THEME;
  }

  function resolveSaved(raw, isDark) {
    var stored = migrateSaved(raw);
    if (stored === 'auto') {
      return { stored: stored, concrete: isDark ? AUTO_DARK_DEFAULT : AUTO_LIGHT_DEFAULT };
    }
    return { stored: stored, concrete: stored };
  }

  // ── 纸质纹理 ──
  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme');
  }

  function isPaperTextureBlocked(theme) {
    theme = theme || getCurrentTheme();
    return PAPER_TEXTURE_BLOCKED.indexOf(theme) !== -1;
  }

  function applyPaperTextureClass(enabled, theme) {
    var effective = enabled && !isPaperTextureBlocked(theme);
    document.body.classList.toggle('paper-texture', effective);
    document.body.classList.remove('no-paper-texture');
  }

  function loadPaperTexturePreference() {
    var enabled = localStorage.getItem('hana-paper-texture') === '1';
    applyPaperTextureClass(enabled, getCurrentTheme());
    return enabled;
  }

  function setPaperTexturePreference(enabled) {
    localStorage.setItem('hana-paper-texture', enabled ? '1' : '0');
    applyPaperTextureClass(enabled, getCurrentTheme());
  }

  // ── 主题切换 ──
  var systemThemeListener = null;

  function applyConcreteTheme(concrete) {
    var entry = THEMES[concrete];
    if (!entry) return;
    document.documentElement.setAttribute('data-theme', concrete);
    if (themeSheet) themeSheet.href = entry.cssPath;
    loadPaperTexturePreference();
  }

  function setTheme(name) {
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (systemThemeListener) {
      mql.removeEventListener('change', systemThemeListener);
      systemThemeListener = null;
    }

    var resolved = resolveSaved(name, systemIsDark());
    applyConcreteTheme(resolved.concrete);

    if (resolved.stored === 'auto') {
      systemThemeListener = function () {
        applyConcreteTheme(resolveSaved('auto', systemIsDark()).concrete);
      };
      mql.addEventListener('change', systemThemeListener);
    }

    localStorage.setItem(STORAGE_KEY, resolved.stored);
  }

  function loadSavedTheme() {
    var raw = localStorage.getItem(STORAGE_KEY);
    setTheme(migrateSaved(raw));
  }

  // ── 衬线体 ──
  function setSerifFont(enabled) {
    document.body.classList.toggle('font-sans', !enabled);
    localStorage.setItem('hana-font-serif', enabled ? '1' : '0');
  }

  function loadSavedFont() {
    var saved = localStorage.getItem('hana-font-serif');
    var enabled = saved !== '0';
    document.body.classList.toggle('font-sans', !enabled);
  }

  function loadSavedPaperTexture() {
    loadPaperTexturePreference();
  }

  // ── 暴露到 window ──
  window.setTheme = setTheme;
  window.applyTheme = setTheme;
  window.loadSavedTheme = loadSavedTheme;
  window.setSerifFont = setSerifFont;
  window.loadSavedFont = loadSavedFont;
  window.setPaperTexture = setPaperTexturePreference;
  window.loadSavedPaperTexture = loadSavedPaperTexture;

  // ── 首屏自动加载 ──
  loadSavedTheme();
  loadSavedFont();
  loadSavedPaperTexture();
})();

/**
 * search-widget.js — 独立搜索组件（不依赖 React）
 *
 * 由 CF Pages Middleware 注入到代理页面（blog / portal）。
 * 使用原生 <dialog> + fetch 实现搜索功能。
 * 不和 React 事件系统交互，绕过 proxy 的 React 事件失效问题。
 */
(function () {
  'use strict';

  // ── 配置 ──────────────────────────────────────────────────
  // search-index 文件路径（相对当前域名）
  function searchIndexUrl(locale) {
    return '/search-index-' + locale + '.json';
  }

  // ── 状态 ──────────────────────────────────────────────────
  var searchIndexCache = {};  // 缓存已加载的索引

  // ── DOM 辅助 ──────────────────────────────────────────────
  function createEl(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') el.className = attrs[k];
        else if (k === 'style') el.style.cssText = attrs[k];
        else if (k.startsWith('data-')) el.setAttribute(k, attrs[k]);
        else el.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === 'string') el.appendChild(document.createTextNode(c));
        else if (c) el.appendChild(c);
      });
    }
    return el;
  }

  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  // ── 获取 locale ───────────────────────────────────────────
  function getLocale() {
    // 从 URL 路径提取: /en/blog/ -> en, /zh/blog/ -> zh
    var m = location.pathname.match(/^\/([a-z]{2})(\/|$)/);
    return m ? m[1] : 'en';
  }

  // ── 加载搜索索引 ──────────────────────────────────────────
  function loadIndex(locale) {
    if (searchIndexCache[locale]) return Promise.resolve(searchIndexCache[locale]);
    return fetch(searchIndexUrl(locale))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        searchIndexCache[locale] = data;
        return data;
      })
      .catch(function () {
        searchIndexCache[locale] = null;
        return null;
      });
  }

  // ── 搜索逻辑 ──────────────────────────────────────────────
  function searchItems(query, index) {
    if (!index || !query.trim()) return [];
    var q = query.toLowerCase().trim();
    var results = [];

    var allItems = [
      { type: 'service', items: index.services || [] },
      { type: 'blog', items: index.blog || [] },
      { type: 'faq', items: index.faq || [] },
    ];

    allItems.forEach(function (section) {
      section.items.forEach(function (item) {
        if (item.searchable && item.searchable.indexOf(q) !== -1) {
          results.push({
            type: section.type,
            title: item.title,
            desc: item.desc || '',
            href: item.href,
          });
        }
      });
    });

    return results;
  }

  // ── 创建搜索弹窗 ──────────────────────────────────────────
  function createSearchDialog() {
    var dialog = createEl('dialog', {
      className: 'sw-dialog',
      style: 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:transparent;border:none;overflow:visible;',
    });

    // 遮罩
    var backdrop = createEl('div', {
      className: 'sw-backdrop',
      style: 'position:fixed;inset:0;z-index:1;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
    });
    backdrop.addEventListener('click', function () { dialog.close(); });

    // 面板
    var panel = createEl('div', {
      className: 'sw-panel',
      style: 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2;width:92%;max-width:640px;max-height:calc(100vh - 8rem);background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;display:flex;flex-direction:column;',
    });

    // 搜索输入
    var inputRow = createEl('div', {
      style: 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #eee;',
    });
    var inputIcon = createEl('span', {}, '🔍');
    var input = createEl('input', {
      type: 'text',
      placeholder: 'Search services, articles, FAQs...',
      className: 'sw-input',
      style: 'flex:1;border:none;outline:none;font-size:16px;background:transparent;',
    });
    var clearBtn = createEl('button', {
      style: 'display:none;padding:4px 8px;background:#f0f0f0;border:none;border-radius:4px;cursor:pointer;font-size:13px;color:#666;',
    }, '✕');
    var escHint = createEl('kbd', {
      style: 'font-size:11px;color:#999;background:#f5f5f5;padding:2px 6px;border-radius:3px;border:1px solid #ddd;display:none;',
    }, 'ESC');

    inputRow.appendChild(inputIcon);
    inputRow.appendChild(input);
    inputRow.appendChild(clearBtn);
    inputRow.appendChild(escHint);
    panel.appendChild(inputRow);

    // 结果区
    var resultsEl = createEl('div', {
      className: 'sw-results',
      style: 'flex:1;overflow-y:auto;min-height:80px;',
    });
    panel.appendChild(resultsEl);

    // 取消按钮组件 + 键盘事件
    panel.appendChild(createEl('div', { style: 'display:none;' })); // 占位

    dialog.appendChild(backdrop);
    dialog.appendChild(panel);
    document.body.appendChild(dialog);

    return { dialog, input, resultsEl, clearBtn, escHint };
  }

  // ── 渲染搜索结果 ──────────────────────────────────────────
  function renderResults(results, resultsEl, locale, typeLabels) {
    resultsEl.innerHTML = '';

    if (!results || results.length === 0) {
      resultsEl.appendChild(createEl('div', {
        style: 'padding:40px;text-align:center;color:#999;font-size:14px;',
      }, 'No results found. Try different keywords.'));
      return;
    }

    // 按 type 分组
    var grouped = {};
    results.forEach(function (r) {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    });

    var order = ['service', 'blog', 'faq'];
    order.forEach(function (type) {
      var items = grouped[type];
      if (!items || items.length === 0) return;

      var label = typeLabels[type] || type;
      resultsEl.appendChild(createEl('div', {
        style: 'padding:8px 20px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#999;',
      }, label + ' (' + items.length + ')'));

      items.forEach(function (item) {
        var link = createEl('a', {
          href: '/' + locale + item.href,
          style: 'display:flex;align-items:flex-start;gap:10px;padding:10px 20px;text-decoration:none;color:inherit;transition:background 0.15s;cursor:pointer;',
          onmouseover: function () { this.style.background = '#f8f9ff'; },
          onmouseout: function () { this.style.background = 'transparent'; },
        });

        var iconMap = { service: '📋', blog: '📖', faq: '❓' };
        var iconEl = createEl('span', { style: 'margin-top:2px;flex-shrink:0;' }, iconMap[item.type] || '📄');
        var textEl = createEl('div', { style: 'min-width:0;' });
        textEl.appendChild(createEl('div', {
          style: 'font-size:14px;font-weight:500;color:#1a1a2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        }, item.title));
        if (item.desc) {
          textEl.appendChild(createEl('div', {
            style: 'font-size:12px;color:#999;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
          }, item.desc));
        }

        link.appendChild(iconEl);
        link.appendChild(textEl);
        link.addEventListener('click', function () {
          // 关闭 dialog（延迟让导航先处理）
          setTimeout(function () { dialog.close(); }, 50);
        });

        resultsEl.appendChild(link);
      });
    });
  }

  // ── 主要启动 ──────────────────────────────────────────────
  function init() {
    // 如果已存在 sw-dialog 则不重复初始化
    if (qs('.sw-dialog')) return;

    var locale = getLocale();
    var typeLabels = { service: 'Services', blog: 'Insights', faq: 'FAQ' };

    var dialogComponents = createSearchDialog();
    var dialog = dialogComponents.dialog;
    var input = dialogComponents.input;
    var resultsEl = dialogComponents.resultsEl;
    var clearBtn = dialogComponents.clearBtn;
    var escHint = dialogComponents.escHint;

    var selectedIndex = -1;

    // 键盘导航
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        dialog.close();
        return;
      }
      if (e.key === 'Enter') {
        var active = resultsEl.querySelector('.sw-active');
        if (active) { active.click(); return; }
      }
    }

    // 搜索输入
    var debounceTimer;
    function handleInput() {
      var q = input.value;
      clearBtn.style.display = q ? 'block' : 'none';
      selectedIndex = -1;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (!q.trim()) {
          resultsEl.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:14px;">Type to search across services, articles and insights</div>';
          return;
        }
        loadIndex(locale).then(function (index) {
          if (!index || input.value !== q) return;
          var results = searchItems(q, index);
          renderResults(results, resultsEl, locale, typeLabels);
        });
      }, 200);
    }

    // 绑定事件
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeyDown);
    clearBtn.addEventListener('click', function () {
      input.value = '';
      input.focus();
      handleInput();
    });

    dialog.addEventListener('close', function () {
      document.body.style.overflow = '';
    });

    // 绑定搜索按钮
    function bindSearchButton() {
      var btn = qs('button[aria-label="Search"]') || qs('.sw-search-trigger');
      if (!btn) {
        // 没找到搜索按钮，等一会儿再试
        setTimeout(bindSearchButton, 500);
        return;
      }
      var origClick = btn.onclick;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        // 阻止 React 的点击事件
        if (origClick) {
          btn.onclick = null;
        }
        if (!dialog.open) {
          // 加载缓存并显示提示
          resultsEl.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:14px;">Type to search across services, articles and insights</div>';
          dialog.showModal();
          setTimeout(function () { input.focus(); }, 100);
        }
      }, true);  // useCapture=true 确保在我们这儿先处理
    }
    bindSearchButton();

    // 加载索引预热
    loadIndex(locale);
  }

  // ── DOM Ready ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

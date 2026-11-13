/*
 * 画师串导出 · 柏宝绘辅助插件
 * 只读取柏宝绘的画师串设置，不写入、不修改任何数据。
 * 生成时间：2026-11-13T19:12:20.142Z
 */
(function () {
'use strict';

/* ===== src/baibai.js ===== */
/**
 * 画师串导出 · 柏宝绘辅助插件
 *
 * 只做一件事：把柏宝绘里保存的画师串读出来，整理成可以复制或下载的文本。
 *
 * 安全边界（重要）：
 * - 只读 extensionSettings['baibai_image']，绝不对它做任何写入。
 * - 不调用 saveSettingsDebounced，不触发设置变更。
 * - 不改动柏宝绘的任何文件、界面节点或内部状态。
 * - 读不到时安静返回空列表，不影响柏宝绘正常工作。
 */

const SETTINGS_KEY = 'baibai_image';

// 柏宝绘的内置只读画师串库。这些不在用户设置里，单独列出来才不会漏。
// 来源：柏宝绘打包文件中 Ki 常量，随版本变化，读不到时忽略。
const BUILTIN_ARTISTS = [
  {
    id: 'bi_default',
    name: '默认画师串',
    prompt:
      '0.8::nnmbpx::,0.8::artist:yalmyu::,0.1::smilesmile1312,::, artist:sh_(shinh), 0.4::chen bin::,0.4::dayama::,healthyman,bacheally,',
    quality: '',
    negative: '',
  },
];

/** 取酒馆上下文；取不到返回 null。 */
function getContext() {
  try {
    return window.SillyTavern?.getContext?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * 读出柏宝绘的 NAI 设置对象。
 * 只读，不保留引用，调用方拿到的是深拷贝，避免误改。
 */
function readBaiBaiNaiSettings() {
  const ctx = getContext();
  const raw = ctx?.extensionSettings?.[SETTINGS_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const nai = raw.nai;
  if (!nai || typeof nai !== 'object') return null;

  try {
    return JSON.parse(JSON.stringify(nai));
  } catch {
    return null;
  }
}

/** 当前启用的画师串 id（空串表示「不使用」）。 */
function readActiveArtistId(nai) {
  const id = nai?.activeArtistId;
  return typeof id === 'string' ? id : '';
}

/** 把一条记录整理成统一的导出形状。 */
function normalizeOne(item, builtin) {
  const name = String(item?.name ?? '').trim();
  const prompt = String(item?.prompt ?? '').trim();
  const quality = String(item?.quality ?? '').trim();
  const negative = String(item?.negative ?? '').trim();
  return {
    id: String(item?.id ?? ''),
    name: name || '未命名画师串',
    prompt,
    quality,
    negative,
    builtin: Boolean(builtin),
    hasOwnQuality: quality.length > 0,
    hasOwnNegative: negative.length > 0,
  };
}

/**
 * 列出全部画师串：用户自己的在前，内置的在后。
 * 同一个 id 只出现一次（用户条目优先）。
 */
function listArtistPresets() {
  const nai = readBaiBaiNaiSettings();
  const activeId = readActiveArtistId(nai);

  const seen = new Set();
  const items = [];

  const userPresets = Array.isArray(nai?.artistPresets) ? nai.artistPresets : [];
  for (const p of userPresets) {
    const one = normalizeOne(p, false);
    if (!one.id || seen.has(one.id)) continue;
    seen.add(one.id);
    items.push(one);
  }

  // 柏宝绘没装或没初始化时，整个列表留空，避免把内置库误当成用户数据
  if (nai === null) {
    return { available: false, activeId: '', items: [] };
  }

  for (const p of BUILTIN_ARTISTS) {
    const one = normalizeOne(p, true);
    if (!one.id || seen.has(one.id)) continue;
    seen.add(one.id);
    items.push(one);
  }

  for (const item of items) {
    item.active = item.id === activeId;
  }

  return {
    available: nai !== null,
    activeId,
    items,
  };
}

/** 渠道级的正面质量词与负面词，仅用于界面提示「跟随渠道时实际是什么」。 */
function readChannelDefaults() {
  const nai = readBaiBaiNaiSettings();
  return {
    quality: String(nai?.qualityTags ?? '').trim(),
    negative: String(nai?.undesiredContent ?? '').trim(),
  };
}

/** 单条格式化。四行「标签：内容」，空值写「无」，方便直接粘进文档。 */
function formatOne(item) {
  return [
    `标题：${item.name}`,
    `画师串：${item.prompt || '无'}`,
    `正面质量词：${item.quality || '无'}`,
    `负面质量词：${item.negative || '无'}`,
  ].join('\n');
}

/** 多条格式化，条目之间空一行。 */
function formatMany(items) {
  return items.map(formatOne).join('\n\n');
}

/** 触发浏览器下载。只生成文件，不碰任何插件数据。 */
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 复制到剪贴板，带旧浏览器回退。 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ===== src/dialog.js ===== */
/**
 * 画师串导出 · 界面
 *
 * 一个弹窗：列出全部画师串，勾选后复制或下载。
 * 不向柏宝绘的界面注入任何节点，只在自己的弹窗里工作。
 */

const STYLE_ID = 'bbe-style';

const CSS = `
.bbe-mask{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px;box-sizing:border-box}
.bbe-dialog{width:min(760px,100%);max-height:86vh;display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor,#17181c);color:var(--SmartThemeBodyColor,#e6e6e6);border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 24px 64px rgba(0,0,0,.6);font-size:14px;overflow:hidden}
.bbe-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.bbe-title{font-size:15px;font-weight:600;letter-spacing:.04em}
.bbe-close{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:inherit;opacity:.6;cursor:pointer;border-radius:6px}
.bbe-close:hover{opacity:1;background:rgba(255,255,255,.08)}
.bbe-bar{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
.bbe-bar button{font:inherit;font-size:13px;padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
.bbe-bar button:hover{background:rgba(255,255,255,.12)}
.bbe-bar button[disabled]{opacity:.4;cursor:not-allowed}
.bbe-count{margin-left:auto;opacity:.6;font-size:12px}
.bbe-list{overflow-y:auto;padding:8px 12px;flex:1;min-height:120px}
.bbe-item{display:flex;align-items:flex-start;gap:10px;padding:10px 8px;border-radius:8px;cursor:pointer}
.bbe-item:hover{background:rgba(255,255,255,.05)}
.bbe-item input{margin-top:3px;flex:0 0 auto;cursor:pointer}
.bbe-item-main{min-width:0;flex:1}
.bbe-item-name{display:flex;align-items:center;gap:8px;font-weight:600;line-height:1.5}
.bbe-item-sub{margin-top:4px;font-size:12px;line-height:1.6;opacity:.62;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bbe-badge{flex:0 0 auto;font-size:11px;font-weight:400;padding:1px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.2);opacity:.75}
.bbe-badge.active{border-color:#4a9;color:#6c9}
.bbe-empty{padding:40px 18px;text-align:center;opacity:.55;line-height:1.8}
.bbe-foot{display:flex;gap:10px;justify-content:flex-end;padding:12px 18px;border-top:1px solid rgba(255,255,255,.08)}
.bbe-foot button{font:inherit;font-size:13px;padding:7px 18px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
.bbe-foot button.primary{background:rgba(120,180,255,.18);border-color:rgba(120,180,255,.45)}
.bbe-foot button[disabled]{opacity:.4;cursor:not-allowed}
.bbe-preview{margin:0;padding:12px 18px;max-height:32vh;overflow:auto;background:rgba(0,0,0,.28);border-top:1px solid rgba(255,255,255,.08);font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-all;display:none}
.bbe-preview.show{display:block}
@media (max-width:520px){
.bbe-dialog{max-height:92vh}
.bbe-bar button{padding:5px 9px}
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** 弹出导出窗口。 */
function openExportDialog() {
  ensureStyle();

  const { available, items } = listArtistPresets();
  const selected = new Set();

  const mask = document.createElement('div');
  mask.className = 'bbe-mask';

  const dialog = document.createElement('div');
  dialog.className = 'bbe-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  dialog.innerHTML = `
    <div class="bbe-head">
      <div class="bbe-title">画师串导出</div>
      <button class="bbe-close" type="button" aria-label="关闭">✕</button>
    </div>
    <div class="bbe-bar">
      <button type="button" class="bbe-all">全选</button>
      <button type="button" class="bbe-none">全不选</button>
      <span class="bbe-count"></span>
    </div>
    <div class="bbe-list"></div>
    <pre class="bbe-preview"></pre>
    <div class="bbe-foot">
      <button type="button" class="bbe-copy" disabled>复制</button>
      <button type="button" class="bbe-save primary" disabled>下载为文本</button>
    </div>
  `;

  mask.appendChild(dialog);

  const listEl = dialog.querySelector('.bbe-list');
  const countEl = dialog.querySelector('.bbe-count');
  const previewEl = dialog.querySelector('.bbe-preview');
  const copyBtn = dialog.querySelector('.bbe-copy');
  const saveBtn = dialog.querySelector('.bbe-save');

  function refresh() {
    countEl.textContent = `共 ${items.length} 条，已选 ${selected.size} 条`;
    const has = selected.size > 0;
    copyBtn.disabled = !has;
    saveBtn.disabled = !has;
    if (has) {
      const picked = items.filter((it) => selected.has(it.id));
      previewEl.textContent = formatMany(picked);
      previewEl.classList.add('show');
    } else {
      previewEl.textContent = '';
      previewEl.classList.remove('show');
    }
  }

  if (!available) {
    listEl.innerHTML = `
      <div class="bbe-empty">
        没有读到柏宝绘的设置。<br>
        请确认柏宝绘已安装并启用。
      </div>
    `;
  } else {
    for (const item of items) {
      const row = document.createElement('label');
      row.className = 'bbe-item';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        if (box.checked) selected.add(item.id);
        else selected.delete(item.id);
        refresh();
      });

      const main = document.createElement('div');
      main.className = 'bbe-item-main';

      const nameRow = document.createElement('div');
      nameRow.className = 'bbe-item-name';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      nameRow.appendChild(nameSpan);

      if (item.builtin) {
        const b = document.createElement('span');
        b.className = 'bbe-badge';
        b.textContent = '内置';
        nameRow.appendChild(b);
      }
      if (item.active) {
        const b = document.createElement('span');
        b.className = 'bbe-badge active';
        b.textContent = '当前启用';
        nameRow.appendChild(b);
      }

      const sub = document.createElement('div');
      sub.className = 'bbe-item-sub';
      sub.textContent = item.prompt || '（画师串为空）';

      main.appendChild(nameRow);
      main.appendChild(sub);
      row.appendChild(box);
      row.appendChild(main);
      listEl.appendChild(row);
    }
  }

  dialog.querySelector('.bbe-all').addEventListener('click', () => {
    selected.clear();
    listEl.querySelectorAll('input[type=checkbox]').forEach((box) => {
      box.checked = true;
    });
    items.forEach((it) => selected.add(it.id));
    refresh();
  });

  dialog.querySelector('.bbe-none').addEventListener('click', () => {
    selected.clear();
    listEl.querySelectorAll('input[type=checkbox]').forEach((box) => {
      box.checked = false;
    });
    refresh();
  });

  copyBtn.addEventListener('click', async () => {
    const picked = items.filter((it) => selected.has(it.id));
    if (!picked.length) return;
    const ok = await copyText(formatMany(picked));
    if (ok) {
      toastr?.success?.(`已复制 ${picked.length} 条画师串`);
    } else {
      toastr?.warning?.('复制失败，请在预览区手动选取');
    }
  });

  saveBtn.addEventListener('click', () => {
    const picked = items.filter((it) => selected.has(it.id));
    if (!picked.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(formatMany(picked), `画师串导出_${stamp}.txt`);
  });

  function close() {
    document.removeEventListener('keydown', onKey);
    mask.remove();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  dialog.querySelector('.bbe-close').addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(mask);
  refresh();
}

/** 导出单条（供未来按需调用）。 */
function exportSingle(itemId) {
  const { items } = listArtistPresets();
  const item = items.find((it) => it.id === itemId);
  if (!item) return null;
  return formatOne(item);
}

/* ===== src/index.js ===== */
/**
 * 画师串导出 · 入口
 *
 * 做法：不向柏宝绘注入任何节点，只在自己创建的 UI 里工作。
 * 入口有两处：
 * 1. 扩展设置页里加一个「画师串导出」区块和按钮。
 * 2. 顶部扩展菜单栏加一个按钮，随时能点。
 */

const EXT_NAME = '画师串导出';
const BTN_CLASS = 'bbe-trigger';

const ICON = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3v12"/>
  <path d="m7 10 5 5 5-5"/>
  <path d="M5 21h14"/>
</svg>
`;

function addMenuButton() {
  if (document.querySelector(`.${BTN_CLASS}`)) return;
  const host =
    document.querySelector('#extensionsMenu') ||
    document.querySelector('#extensions_menu') ||
    document.querySelector('#extensions-settings-button')?.parentElement;
  if (!host) return;

  const btn = document.createElement('div');
  btn.className = `list-group-item flex-container flexGap5 interactable ${BTN_CLASS}`;
  btn.tabIndex = 0;
  btn.title = EXT_NAME;
  btn.innerHTML = `${ICON}<span>${EXT_NAME}</span>`;
  btn.addEventListener('click', () => {
    openExportDialog();
    // 点完收起扩展菜单，和酒馆其它菜单项行为一致
    try {
      window.SillyTavern?.getContext?.()?.hideExtensionsMenu?.();
    } catch {
      /* 接口不存在时忽略 */
    }
  });

  host.appendChild(btn);
}

function addSettingsBlock() {
  const container = document.querySelector('#extensions_settings2') ||
    document.querySelector('#extensions_settings');
  if (!container || document.querySelector('#bbe-settings-block')) return;

  const block = document.createElement('div');
  block.id = 'bbe-settings-block';
  block.className = 'inline-drawer';
  block.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>${EXT_NAME}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="padding:10px 0;">
      <div style="opacity:.72;font-size:12px;line-height:1.7;margin-bottom:10px;">
        把柏宝绘里保存的画师串导出成文本。只读取，不会修改柏宝绘的任何设置。
      </div>
      <button type="button" class="menu_button" id="bbe-open-btn">打开导出面板</button>
    </div>
  `;
  block.querySelector('#bbe-open-btn').addEventListener('click', () => openExportDialog());
  container.appendChild(block);
}

function boot() {
  addMenuButton();
  addSettingsBlock();
}

// 酒馆的扩展菜单和设置区是构建后才有的，等 DOM 就绪再挂。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// 酒馆切页面或主题重建菜单时按钮会掉，定时补回。
// 按钮已存在时直接 return，不会重复插入。
setInterval(boot, 2000);

})();

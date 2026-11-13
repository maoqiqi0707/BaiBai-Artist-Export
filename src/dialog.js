/**
 * 画师串导出 · 界面
 *
 * 一个弹窗：列出全部画师串，勾选后复制或下载。
 * 不向柏宝绘的界面注入任何节点，只在自己的弹窗里工作。
 */

import {
  listArtistPresets,
  formatOne,
  formatMany,
  downloadText,
  copyText,
} from './baibai.js';

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
export function openExportDialog() {
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
export function exportSingle(itemId) {
  const { items } = listArtistPresets();
  const item = items.find((it) => it.id === itemId);
  if (!item) return null;
  return formatOne(item);
}

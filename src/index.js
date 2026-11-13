/**
 * 画师串导出 · 入口
 *
 * 做法：不向柏宝绘注入任何节点，只在自己创建的 UI 里工作。
 * 入口有两处：
 * 1. 扩展设置页里加一个「画师串导出」区块和按钮。
 * 2. 顶部扩展菜单栏加一个按钮，随时能点。
 */

import { openExportDialog } from './dialog.js';

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

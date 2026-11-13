/**
 * 画师串导出 · 入口
 *
 * 做法：不向柏宝绘注入任何节点，只在自己创建的 UI 里工作。
 * 入口有两处：
 * 1. 扩展设置页里加一个区块和按钮。
 * 2. 顶部扩展菜单栏加一个按钮，随时能点。
 *
 * 注意：打包时本文件与 dialog.js 会被拼进同一个作用域，
 * 所以这里所有模块级常量都加了 Entry 前缀，避免重名。
 */

import { openExportDialog } from './dialog.js';

const ENTRY_NAME = '画师串导出';
const ENTRY_BTN_CLASS = 'bbe-trigger';
const ENTRY_STYLE_ID = 'bbe-entry-style';

const ENTRY_ICON = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3v12"/>
  <path d="m7 10 5 5 5-5"/>
  <path d="M5 21h14"/>
</svg>
`;

/**
 * 只补一条规则：强制横向排字。
 * 配色、边框、悬停一律交回酒馆原生样式，不覆盖任何颜色，
 * 免得出现白底白字这种看不清的情况。
 */
const ENTRY_CSS = `
#bbe-settings-block .menu_button{
  writing-mode:horizontal-tb;
  text-orientation:mixed;
  white-space:nowrap;
  word-break:keep-all;
}
`;

function ensureEntryStyle() {
  if (document.getElementById(ENTRY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ENTRY_STYLE_ID;
  style.textContent = ENTRY_CSS;
  document.head.appendChild(style);
}

function addMenuButton() {
  if (document.querySelector(`.${ENTRY_BTN_CLASS}`)) return;
  const host =
    document.querySelector('#extensionsMenu') ||
    document.querySelector('#extensions_menu') ||
    document.querySelector('#extensions-settings-button')?.parentElement;
  if (!host) return;

  const btn = document.createElement('div');
  btn.className = `list-group-item flex-container flexGap5 interactable ${ENTRY_BTN_CLASS}`;
  btn.tabIndex = 0;
  btn.title = ENTRY_NAME;
  btn.innerHTML = `${ENTRY_ICON}<span>${ENTRY_NAME}</span>`;
  btn.addEventListener('click', () => {
    openExportDialog();
    try {
      window.SillyTavern?.getContext?.()?.hideExtensionsMenu?.();
    } catch {
      /* 接口不存在时忽略 */
    }
  });

  host.appendChild(btn);
}

function addSettingsBlock() {
  const container =
    document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!container || document.querySelector('#bbe-settings-block')) return;

  ensureEntryStyle();

  const block = document.createElement('div');
  block.id = 'bbe-settings-block';
  block.className = 'inline-drawer';
  block.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>${ENTRY_NAME}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="padding:10px 0;">
      <div style="opacity:.72;font-size:12px;line-height:1.7;margin-bottom:10px;">
        导出柏宝绘里的画师串与角色图片。只读取，不会改动柏宝绘的任何设置。
      </div>
      <div class="flex-container flexGap5">
        <input type="button" class="menu_button" id="bbe-open-btn" value="打开导出面板">
      </div>
    </div>
  `;
  block.querySelector('#bbe-open-btn').addEventListener('click', () => openExportDialog());
  container.appendChild(block);
}

function boot() {
  addMenuButton();
  addSettingsBlock();
}

/**
 * 只在真正需要的时候补挂一次，不再用定时器轮询。
 *
 * 之前每 2 秒跑一次 boot，会不停触碰酒馆的折叠容器，
 * 导致点开面板时扩展区自己收回去。现在改为：
 * - DOM 就绪时挂一次；
 * - 酒馆发出事件通知时才补挂。
 */
function bootOnce() {
  try {
    boot();
  } catch (err) {
    console.debug('[画师串导出] 挂载跳过', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootOnce, { once: true });
} else {
  bootOnce();
}

// 酒馆切换聊天、重载界面后菜单会被重建，这些事件里补挂。
for (const evt of ['app_ready', 'chat_changed', 'extensions_loaded', 'settings_loaded']) {
  try {
    window.SillyTavern?.getContext?.()?.eventSource?.on?.(evt, bootOnce);
  } catch {
    /* 事件接口不可用就忽略，首次挂载已经够了 */
  }
}

/*
 * 画师串导出 · 柏宝绘辅助插件
 * 只读取柏宝绘的画师串设置与图库，不写入、不修改任何数据。
 * 生成时间：2026-11-13T21:04:15.296Z
 */
(function () {
'use strict';

/* ===== src/baibai.js ===== */
/**
 * 读取柏宝绘的画师串数据
 *
 * 安全边界（重要）：
 * - 只读 extensionSettings['baibai_image']，绝不对它做任何写入。
 * - 不调用 saveSettingsDebounced，不触发设置变更。
 * - 不改动柏宝绘的任何文件、界面节点或内部状态。
 * - 读不到时安静返回空列表，不影响柏宝绘正常工作。
 */

const SETTINGS_KEY = 'baibai_image';

// 柏宝绘的内置只读画师串库。这些不在用户设置里，单独列出来才不会漏。
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

/* ===== src/gallery.js ===== */
/**
 * 图库读取与导出
 *
 * 安全边界：
 * - 只调用酒馆的图片读取接口（folders / list），不调用删除、上传、修改接口。
 * - 不修改柏宝绘的任何设置。
 * - 图片通过浏览器直接下载，不经过柏宝绘。
 */

// 柏宝绘图库的文件夹前缀。文件夹形如「柏宝绘_角色名」。
const GALLERY_PREFIX = '柏宝绘_';
// 画师串预览图目录，不属于角色图库，排除掉。
const ARTIST_FOLDER = '柏宝绘_画师串';

function getCtx() {
  try {
    return window.SillyTavern?.getContext?.() ?? null;
  } catch {
    return null;
  }
}

async function postJson(path, body) {
  const ctx = getCtx();
  if (!ctx) throw new Error('酒馆上下文不可用');
  const res = await fetch(path, {
    method: 'POST',
    headers: ctx.getRequestHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`读取失败 (${res.status})${text ? '：' + text.slice(0, 200) : ''}`);
  }
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * 列出图库里的全部角色分组及其图片。
 * 图片按时间从旧到新排列，编号从 1 开始，1 号就是最早生成的那张。
 */
async function listGalleryGroups() {
  const folders = (await postJson('/api/images/folders', {}))
    .filter((f) => typeof f === 'string')
    .filter((f) => f.startsWith(GALLERY_PREFIX) && f !== ARTIST_FOLDER);

  const groups = [];

  for (const folder of folders) {
    let files = [];
    try {
      files = (await postJson('/api/images/list', { folder, sortField: 'date', sortOrder: 'asc' }))
        .filter((f) => typeof f === 'string')
        .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const name = folder.slice(GALLERY_PREFIX.length) || '未命名角色';
    groups.push({ folder, name, files });
  }

  const collator = new Intl.Collator('zh-Hans-CN');
  groups.sort((a, b) => collator.compare(a.name, b.name));
  return groups;
}

/** 单张图片的可访问地址。 */
function imageUrl(folder, file) {
  return `/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
}

/** 取扩展名，没有就用 png。 */
function extOf(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file);
  return m ? m[1].toLowerCase() : 'png';
}

/** Windows 文件名不允许的字符统一替换。 */
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 逐张下载，文件名「角色名+序号」，每个角色各自从 1 开始计数。
 */
async function downloadImages(selected, onProgress, signal) {
  const total = selected.length;
  const counters = new Map();
  const aborted = () => signal?.aborted === true;
  let done = 0;

  for (let i = 0; i < total; i += 1) {
    if (aborted()) break;
    const item = selected[i];
    const n = (counters.get(item.folder) ?? 0) + 1;
    counters.set(item.folder, n);

    const filename = `${safeName(item.name)}${n}.${extOf(item.file)}`;
    onProgress?.({ phase: 'download', done: i, total, current: filename });

    try {
      const res = await fetch(imageUrl(item.folder, item.file), { signal });
      if (!res.ok) throw new Error(`下载失败 ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      done += 1;
    } catch (err) {
      if (err?.name === 'AbortError') break;
      console.warn('[图库导出] 跳过一张', filename, err);
    }

    // 浏览器对连续下载有限流，每张之间稍作间隔
    await new Promise((r) => setTimeout(r, 260));
  }

  onProgress?.({ phase: aborted() ? 'aborted' : 'done', done: total, total, current: '' });
  return { count: done, aborted: aborted() };
}

/* ===== 以下是最小 zip 实现（store 模式，不压缩） ===== */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  // bit 11 = 文件名使用 UTF-8。不置这个标志，Windows 会按本地代码页解析，中文变乱码。
  const UTF8_FLAG = 0x0800;

  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const all = [...localParts, ...centralParts, end];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/**
 * 打包成 zip 下载。zip 内按「角色名/角色名1.png」分文件夹。
 */
async function downloadImagesZip(selected, onProgress, signal) {
  const total = selected.length;
  const counters = new Map();
  const entries = [];
  const aborted = () => signal?.aborted === true;

  for (let i = 0; i < total; i += 1) {
    if (aborted()) break;
    const item = selected[i];
    const n = (counters.get(item.folder) ?? 0) + 1;
    counters.set(item.folder, n);

    const folderName = safeName(item.name);
    const name = `${folderName}/${folderName}${n}.${extOf(item.file)}`;
    onProgress?.({ phase: 'pack', done: i, total, current: name });

    try {
      const res = await fetch(imageUrl(item.folder, item.file), { signal });
      if (!res.ok) throw new Error(`读取失败 ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      entries.push({ name, data: buf });
    } catch (err) {
      if (err?.name === 'AbortError') break;
      console.warn('[图库导出] 打包时跳过一张', name, err);
    }
  }

  if (aborted() || !entries.length) {
    return { count: 0, aborted: aborted() };
  }

  onProgress?.({ phase: 'zip', done: total, total, current: '' });
  await new Promise((r) => setTimeout(r, 30));

  const zip = buildZip(entries);
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `图库导出_${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  onProgress?.({ phase: 'done', done: total, total, current: '' });
  return { count: entries.length, aborted: false };
}

/* ===== src/dialog.js ===== */
/**
 * 导出面板 · 界面
 *
 * 横向布局：左侧列表、右侧预览与操作，整体高度受控，不会把页面撑高。
 * 两个页签：画师串、角色图片。
 * 不向柏宝绘的界面注入任何节点，只在自己的面板里工作。
 */


const STYLE_ID = 'bbe-style';

const CSS = `
.bbe-mask{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:12px;box-sizing:border-box}
.bbe-panel{width:min(980px,100%);height:min(560px,78vh);display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor,#17181c);color:var(--SmartThemeBodyColor,#e6e6e6);border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 20px 56px rgba(0,0,0,.55);font-size:13px;overflow:hidden}

/* 顶部：标题 + 页签 + 关闭，只有一行 */
.bbe-head{display:flex;align-items:center;gap:14px;padding:0 14px;height:44px;flex:0 0 auto;border-bottom:1px solid rgba(255,255,255,.08)}
.bbe-title{font-size:14px;font-weight:600;letter-spacing:.04em}
.bbe-tabs{display:flex;gap:2px;margin-left:6px}
.bbe-tab{font:inherit;font-size:12.5px;padding:5px 13px;border:0;border-radius:6px;background:none;color:inherit;opacity:.6;cursor:pointer}
.bbe-tab:hover{opacity:.9;background:rgba(255,255,255,.06)}
.bbe-tab.on{opacity:1;background:rgba(255,255,255,.12)}
.bbe-close{margin-left:auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:inherit;opacity:.55;cursor:pointer;border-radius:6px;font-size:13px}
.bbe-close:hover{opacity:1;background:rgba(255,255,255,.1)}

/* 主体：左右两栏 */
.bbe-body{flex:1;display:flex;min-height:0}
.bbe-left{width:46%;min-width:250px;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.08)}
.bbe-right{flex:1;display:flex;flex-direction:column;min-width:0}

/* 左侧工具条 */
.bbe-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:0 0 auto;border-bottom:1px solid rgba(255,255,255,.06)}
.bbe-bar button{font:inherit;font-size:12px;padding:4px 10px;border-radius:5px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:inherit;cursor:pointer}
.bbe-bar button:hover{background:rgba(255,255,255,.12)}
.bbe-bar button[disabled]{opacity:.35;cursor:not-allowed}
.bbe-count{margin-left:auto;opacity:.55;font-size:11.5px;white-space:nowrap}

/* 左侧列表 */
.bbe-list{flex:1;overflow-y:auto;padding:4px 8px}
.bbe-item{display:flex;align-items:flex-start;gap:8px;padding:8px 8px;border-radius:6px;cursor:pointer}
.bbe-item:hover{background:rgba(255,255,255,.05)}
.bbe-item input{margin-top:2px;flex:0 0 auto;cursor:pointer}
.bbe-item-main{min-width:0;flex:1}
.bbe-item-name{display:flex;align-items:center;gap:6px;font-weight:600;line-height:1.45;font-size:12.5px}
.bbe-item-sub{margin-top:2px;font-size:11.5px;line-height:1.5;opacity:.55;word-break:break-all;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bbe-badge{flex:0 0 auto;font-size:10.5px;font-weight:400;padding:0 5px;border-radius:4px;border:1px solid rgba(255,255,255,.18);opacity:.7}
.bbe-badge.active{border-color:#4a9;color:#6c9}

/* 分组（图片页） */
.bbe-group{margin-bottom:4px}
.bbe-group-head{display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;font-weight:600;opacity:.8;cursor:pointer}
.bbe-group-head span.n{margin-left:auto;font-weight:400;opacity:.5;font-size:11px}
.bbe-thumbs{display:flex;flex-wrap:wrap;gap:4px;padding:2px 8px 8px 26px}
.bbe-thumb{width:46px;height:46px;border-radius:4px;overflow:hidden;border:1px solid rgba(255,255,255,.12);cursor:pointer;position:relative;background:rgba(0,0,0,.3)}
.bbe-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.bbe-thumb:hover{border-color:rgba(255,255,255,.35)}
.bbe-thumb.on{border-color:#6c9;box-shadow:0 0 0 2px rgba(108,204,153,.55)}
.bbe-thumb.on::after{content:'';position:absolute;inset:0;background:rgba(108,204,153,.18);pointer-events:none}
/* 选中标记：右上角一个小三角，不改动点击行为 */
.bbe-thumb.on::before{content:'';position:absolute;top:0;right:0;z-index:2;border-style:solid;border-width:0 14px 14px 0;border-color:transparent #6cc99a transparent transparent}

/* 右侧图片预览区 */
.bbe-imgpreview{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;min-height:0;overflow:hidden}
.bbe-imgpreview img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;cursor:zoom-in;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.bbe-imgpreview .cap{font-size:11.5px;opacity:.6;flex:0 0 auto}
.bbe-imgpreview .multi{font-size:11.5px;opacity:.6;line-height:1.8;text-align:center}
.bbe-imgpreview .multi b{display:block;font-size:13px;opacity:.9;margin-bottom:4px}

/* 大图预览 */
.bbe-lightbox{position:fixed;inset:0;z-index:100002;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);padding:24px;box-sizing:border-box;cursor:zoom-out}
.bbe-lightbox-inner{max-width:100%;max-height:100%;display:flex;flex-direction:column;align-items:center;gap:8px}
.bbe-lightbox-inner img{max-width:100%;max-height:calc(100vh - 90px);object-fit:contain;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.7)}
.bbe-lightbox-cap{font-size:12px;opacity:.7}

/* 悬浮进度窗：只有一条进度和 x/x */
.bbe-float{position:fixed;right:18px;bottom:18px;z-index:100003;width:220px;padding:10px 12px;border-radius:8px;background:var(--SmartThemeBlurTintColor,#1b1c21);color:var(--SmartThemeBodyColor,#e6e6e6);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 28px rgba(0,0,0,.5);font-size:12px;box-sizing:border-box;transition:opacity .24s ease,transform .24s ease}
.bbe-float.out{opacity:0;transform:translateY(6px)}
.bbe-float-head{display:flex;align-items:center;gap:8px}
.bbe-float-label{font-weight:600;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bbe-float-x{flex:0 0 auto;width:18px;height:18px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:inherit;opacity:.5;cursor:pointer;border-radius:4px;font-size:11px;padding:0}
.bbe-float-x:hover{opacity:1;background:rgba(255,255,255,.1)}
.bbe-float-text{margin-top:6px;font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}
.bbe-float-track{margin-top:6px;height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}
.bbe-float-fill{height:100%;width:0;border-radius:2px;background:#7ab4ff;transition:width .2s ease}
.bbe-float.ok{border-color:rgba(108,204,153,.55)}
.bbe-float.ok .bbe-float-fill{background:#6cc99a}
.bbe-float.ok .bbe-float-text{color:#8fdcb4;opacity:1}
.bbe-float.bad{border-color:rgba(230,120,120,.5)}
.bbe-float.bad .bbe-float-fill{background:#e67878}
.bbe-float.bad .bbe-float-text{color:#e8a0a0;opacity:1}

/* 右侧预览 */
.bbe-preview-head{display:flex;align-items:center;gap:8px;padding:8px 12px;flex:0 0 auto;border-bottom:1px solid rgba(255,255,255,.06);font-size:11.5px;opacity:.6}
.bbe-preview{flex:1;margin:0;padding:10px 12px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all}
.bbe-hint{padding:18px 12px;opacity:.45;line-height:1.8;font-size:12px}

/* 底部操作条 */
.bbe-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:9px 14px;flex:0 0 auto;border-top:1px solid rgba(255,255,255,.08)}
.bbe-foot .grow{flex:1;font-size:11.5px;opacity:.55;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bbe-foot button{font:inherit;font-size:12.5px;padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;white-space:nowrap}
.bbe-foot button:hover{background:rgba(255,255,255,.13)}
.bbe-foot button.primary{background:rgba(120,180,255,.18);border-color:rgba(120,180,255,.45)}
.bbe-foot button[disabled]{opacity:.35;cursor:not-allowed}

.bbe-empty{padding:36px 16px;text-align:center;opacity:.5;line-height:1.8;font-size:12px}

/* ============ 手机适配 ============
   断点用像素，关键尺寸全部用 px，不用 vh 叠算，
   避免手机浏览器地址栏伸缩导致高度跳变。
   触屏下点击直接就选中，不依赖 hover。 */
@media (max-width: 700px){
  .bbe-mask{padding:0;align-items:stretch}
  .bbe-panel{
    width:100%;
    max-width:100%;
    height:100%;
    max-height:none;
    border-radius:0;
    border:0;
    font-size:14px;
  }
  .bbe-head{height:48px;padding:0 10px;gap:8px;flex:0 0 48px}
  .bbe-title{font-size:15px}
  .bbe-tabs{margin-left:2px}
  .bbe-tab{font-size:13px;padding:7px 11px}
  .bbe-close{width:34px;height:34px;font-size:16px}

  /* 手机改为上下排列：上面列表，下面预览，用固定像素高度 */
  .bbe-body{flex-direction:column}
  .bbe-left{
    width:100%;
    min-width:0;
    height:300px;
    max-height:300px;
    flex:0 0 300px;
    border-right:0;
    border-bottom:1px solid rgba(255,255,255,.08);
  }
  .bbe-right{flex:1 1 auto;height:auto;min-height:160px}

  .bbe-bar{padding:8px 8px;gap:6px}
  .bbe-bar button{font-size:13px;padding:7px 12px}
  .bbe-count{font-size:12px}

  .bbe-list{padding:4px 6px}
  /* 条目加大，手指点得中 */
  .bbe-item{padding:11px 8px;gap:10px}
  .bbe-item input{width:18px;height:18px;margin-top:0}
  .bbe-item-name{font-size:13.5px}
  .bbe-item-sub{font-size:12px}

  .bbe-group-head{padding:9px 8px;font-size:13px}
  .bbe-group-head input{width:18px;height:18px}
  .bbe-thumbs{gap:6px;padding:2px 6px 10px 28px}
  /* 缩略图放大到 58px，符合手指点击区域 */
  .bbe-thumb{width:58px;height:58px;cursor:pointer}
  .bbe-thumb.on::before{border-width:0 17px 17px 0}

  .bbe-imgpreview{padding:8px;gap:6px}
  .bbe-imgpreview img{max-height:calc(100% - 22px)}
  .bbe-imgpreview .cap{font-size:12px}

  .bbe-foot{padding:10px 10px}
  .bbe-foot button{font-size:13.5px;padding:10px 14px}
  .bbe-foot .grow{display:none}

  /* 悬浮进度条在手机上放大并贴边 */
  .bbe-float{right:10px;bottom:10px;width:200px;padding:11px 12px}
  .bbe-float-x{width:26px;height:26px;font-size:14px}
  .bbe-float-text{font-size:12px}

  .bbe-lightbox{padding:8px}
  .bbe-lightbox-inner img{max-height:calc(100vh - 60px)}
}

/* 触屏设备：去掉依赖悬停的效果，点击即选中 */
@media (hover: none){
  .bbe-thumb:hover{border-color:rgba(255,255,255,.12)}
  .bbe-thumb{cursor:pointer;-webkit-tap-highlight-color:transparent}
  .bbe-item:hover,.bbe-tab:hover,.bbe-bar button:hover{background:none}
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * 悬浮进度窗。打包或下载开始时出现在右下角，只有一条进度和 x/x 数字。
 * 进行中可点叉取消；完成后变绿，短暂停留后自动消失。
 */
function openFloatBar(label) {
  const box = el('div', 'bbe-float');
  const head = el('div', 'bbe-float-head');
  head.appendChild(el('span', 'bbe-float-label', label));

  const closeBtn = el('button', 'bbe-float-x', '✕');
  closeBtn.type = 'button';
  closeBtn.title = '取消';
  head.appendChild(closeBtn);

  const text = el('div', 'bbe-float-text', '准备中…');
  const track = el('div', 'bbe-float-track');
  const fill = el('div', 'bbe-float-fill');
  track.appendChild(fill);

  box.append(head, text, track);
  document.body.appendChild(box);

  const controller = new AbortController();
  let finished = false;

  function destroy() {
    box.classList.add('out');
    setTimeout(() => box.remove(), 260);
  }

  function finish(ok, msg) {
    if (finished) return;
    finished = true;
    box.classList.add(ok ? 'ok' : 'bad');
    text.textContent = msg;
    fill.style.width = '100%';
    setTimeout(destroy, ok ? 900 : 2600);
  }

  closeBtn.addEventListener('click', () => {
    if (finished) {
      destroy();
      return;
    }
    controller.abort();
    text.textContent = '正在取消…';
  });

  return {
    signal: controller.signal,
    update(done, total, phase) {
      if (finished) return;
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      fill.style.width = `${pct}%`;
      text.textContent = `${phase || '进行中'} ${done}/${total}`;
    },
    succeed(msg) {
      finish(true, msg);
    },
    fail(msg) {
      finish(false, msg || '处理失败');
    },
    aborted() {
      finish(false, '已取消');
    },
  };
}

/** 大图预览。点缩略图打开，点任意处或按 Esc 关闭。 */
function makeLightbox() {
  let node = null;

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  return {
    open(src, caption) {
      close();
      node = el('div', 'bbe-lightbox');
      const box = el('div', 'bbe-lightbox-inner');
      const img = document.createElement('img');
      img.src = src;
      img.alt = caption;
      box.append(img, el('div', 'bbe-lightbox-cap', caption));
      node.appendChild(box);
      node.addEventListener('click', close);
      document.body.appendChild(node);
      document.addEventListener('keydown', onKey);
    },
    close,
  };
}

/** 打开导出面板。 */
function openExportDialog() {
  ensureStyle();

  const mask = el('div', 'bbe-mask');
  const panel = el('div', 'bbe-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const head = el('div', 'bbe-head');
  head.appendChild(el('div', 'bbe-title', '导出'));

  const tabs = el('div', 'bbe-tabs');
  const tabArtist = el('button', 'bbe-tab on', '画师串');
  const tabImage = el('button', 'bbe-tab', '角色图片');
  tabArtist.type = 'button';
  tabImage.type = 'button';
  tabs.append(tabArtist, tabImage);
  head.appendChild(tabs);

  const closeBtn = el('button', 'bbe-close', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '关闭');
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const body = el('div', 'bbe-body');
  const left = el('div', 'bbe-left');
  const right = el('div', 'bbe-right');
  body.append(left, right);
  panel.appendChild(body);

  const foot = el('div', 'bbe-foot');
  panel.appendChild(foot);

  let mode = 'artist';
  const artistSelected = new Set();
  const imageSelected = new Set();
  let groups = [];

  function close() {
    document.removeEventListener('keydown', onKey);
    mask.remove();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  closeBtn.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.addEventListener('keydown', onKey);

  /* ============ 画师串页 ============ */
  function renderArtist() {
    left.innerHTML = '';
    right.innerHTML = '';
    foot.innerHTML = '';
    tabArtist.classList.add('on');
    tabImage.classList.remove('on');

    const { available, items } = listArtistPresets();

    const bar = el('div', 'bbe-bar');
    const allBtn = el('button', null, '全选');
    const noneBtn = el('button', null, '全不选');
    allBtn.type = 'button';
    noneBtn.type = 'button';
    const count = el('span', 'bbe-count');
    bar.append(allBtn, noneBtn, count);
    left.appendChild(bar);

    const list = el('div', 'bbe-list');
    left.appendChild(list);

    right.appendChild(el('div', 'bbe-preview-head', '预览'));
    const preview = el('pre', 'bbe-preview');
    right.appendChild(preview);

    const tip = el('div', 'grow');
    const copyBtn = el('button', null, '复制');
    const saveBtn = el('button', 'primary', '下载文本');
    copyBtn.type = 'button';
    saveBtn.type = 'button';
    foot.append(tip, copyBtn, saveBtn);

    function refresh() {
      const picked = items.filter((it) => artistSelected.has(it.id));
      count.textContent = `共 ${items.length} 条，已选 ${picked.length} 条`;
      const has = picked.length > 0;
      copyBtn.disabled = !has;
      saveBtn.disabled = !has;
      preview.textContent = has ? formatMany(picked) : '';
      tip.textContent = has ? '' : '勾选左侧条目查看导出内容';
    }

    if (!available) {
      const empty = el('div', 'bbe-empty');
      empty.innerHTML = '没有读到柏宝绘的设置。<br>请确认柏宝绘已安装并启用。';
      list.appendChild(empty);
      refresh();
      return;
    }

    for (const item of items) {
      const row = el('label', 'bbe-item');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = artistSelected.has(item.id);
      box.addEventListener('change', () => {
        if (box.checked) artistSelected.add(item.id);
        else artistSelected.delete(item.id);
        refresh();
      });

      const main = el('div', 'bbe-item-main');
      const nameRow = el('div', 'bbe-item-name');
      nameRow.appendChild(el('span', null, item.name));
      if (item.builtin) nameRow.appendChild(el('span', 'bbe-badge', '内置'));
      if (item.active) nameRow.appendChild(el('span', 'bbe-badge active', '当前启用'));
      main.appendChild(nameRow);
      main.appendChild(el('div', 'bbe-item-sub', item.prompt || '（画师串为空）'));

      row.append(box, main);
      list.appendChild(row);
    }

    allBtn.addEventListener('click', () => {
      items.forEach((it) => artistSelected.add(it.id));
      list.querySelectorAll('input[type=checkbox]').forEach((b) => (b.checked = true));
      refresh();
    });
    noneBtn.addEventListener('click', () => {
      artistSelected.clear();
      list.querySelectorAll('input[type=checkbox]').forEach((b) => (b.checked = false));
      refresh();
    });

    copyBtn.addEventListener('click', async () => {
      const picked = items.filter((it) => artistSelected.has(it.id));
      if (!picked.length) return;
      const ok = await copyText(formatMany(picked));
      toastr?.[ok ? 'success' : 'warning']?.(
        ok ? `已复制 ${picked.length} 条画师串` : '复制失败，请手动选取预览区内容',
      );
    });

    saveBtn.addEventListener('click', () => {
      const picked = items.filter((it) => artistSelected.has(it.id));
      if (!picked.length) return;
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(formatMany(picked), `画师串导出_${stamp}.txt`);
    });

    refresh();
  }

  /* ============ 图片页 ============ */
  async function renderImage() {
    left.innerHTML = '';
    right.innerHTML = '';
    foot.innerHTML = '';
    tabArtist.classList.remove('on');
    tabImage.classList.add('on');

    const bar = el('div', 'bbe-bar');
    const allBtn = el('button', null, '全选');
    const noneBtn = el('button', null, '全不选');
    allBtn.type = 'button';
    noneBtn.type = 'button';
    allBtn.disabled = true;
    noneBtn.disabled = true;
    const count = el('span', 'bbe-count', '读取中…');
    bar.append(allBtn, noneBtn, count);
    left.appendChild(bar);

    const list = el('div', 'bbe-list');
    left.appendChild(list);

    const hint = el('div', 'bbe-hint', '正在读取图库…');
    right.appendChild(hint);

    const tip = el('div', 'grow');
    const zipBtn = el('button', 'primary', '打包 ZIP');
    const dlBtn = el('button', null, '逐张下载');
    zipBtn.type = 'button';
    dlBtn.type = 'button';
    zipBtn.disabled = true;
    dlBtn.disabled = true;
    foot.append(tip, dlBtn, zipBtn);

    try {
      groups = await listGalleryGroups();
    } catch (err) {
      hint.textContent = `读取图库失败：${err?.message ?? err}`;
      list.innerHTML = '';
      return;
    }

    hint.remove();

    if (!groups.length) {
      const empty = el('div', 'bbe-empty');
      empty.innerHTML = '图库里没有找到图片。<br>柏宝绘生成的图会按角色名分好组。';
      list.appendChild(empty);
      count.textContent = '共 0 张';
      return;
    }

    const allImages = groups.flatMap((g) =>
      g.files.map((f) => ({ folder: g.folder, name: g.name, file: f, key: `${g.folder}/${f}` })),
    );

    const thumbsByKey = new Map();
    const srcByKey = new Map();
    const capByKey = new Map();
    let lastClickedKey = null;

    // 右侧预览区
    const previewBox = el('div', 'bbe-imgpreview');
    const previewImg = document.createElement('img');
    const previewCap = el('div', 'cap');
    const previewMulti = el('div', 'multi');
    previewBox.append(previewImg, previewCap, previewMulti);
    right.appendChild(previewBox);

    const lightbox = makeLightbox();
    previewImg.addEventListener('click', () => {
      if (previewImg.dataset.src) lightbox.open(previewImg.dataset.src, previewImg.dataset.cap || '');
    });

    /**
     * 右侧预览：
     * - 没选任何图：显示提示
     * - 选了一张：显示大图
     * - 选了多张：显示最后点的那张，并标明共选了几张
     */
    function renderPreview() {
      const picked = allImages.filter((it) => imageSelected.has(it.key));

      if (!picked.length) {
        previewImg.style.display = 'none';
        previewCap.textContent = '';
        previewMulti.textContent = '';
        previewMulti.style.display = 'block';
        previewMulti.innerHTML = '点左侧缩略图即可选中<br>选中的图会在这里预览';
        return;
      }

      const target =
        (lastClickedKey && imageSelected.has(lastClickedKey)
          ? picked.find((it) => it.key === lastClickedKey)
          : null) ?? picked[picked.length - 1];

      const src = srcByKey.get(target.key) || '';
      const cap = capByKey.get(target.key) || '';

      previewImg.style.display = 'block';
      previewImg.src = src;
      previewImg.dataset.src = src;
      previewImg.dataset.cap = cap;
      previewImg.alt = cap;
      previewCap.textContent = cap;

      if (picked.length > 1) {
        previewMulti.style.display = 'block';
        previewMulti.innerHTML = `已选 <b>${picked.length}</b> 张，点左侧任意缩略图查看`;
      } else {
        previewMulti.style.display = 'none';
        previewMulti.textContent = '';
      }
    }

    function refresh() {
      const n = imageSelected.size;
      count.textContent = `共 ${allImages.length} 张，已选 ${n} 张`;
      zipBtn.disabled = n === 0;
      dlBtn.disabled = n === 0;
      allBtn.disabled = false;
      noneBtn.disabled = false;
      for (const [key, node] of thumbsByKey) node.classList.toggle('on', imageSelected.has(key));
      renderPreview();
    }

    for (const g of groups) {
      const groupEl = el('div', 'bbe-group');
      const headEl = el('label', 'bbe-group-head');
      const gbox = document.createElement('input');
      gbox.type = 'checkbox';
      headEl.append(gbox, el('span', null, g.name), el('span', 'n', `${g.files.length} 张`));
      groupEl.appendChild(headEl);

      const thumbs = el('div', 'bbe-thumbs');
      const groupKeys = [];
      let indexInGroup = 0;

      for (const file of g.files) {
        const key = `${g.folder}/${file}`;
        groupKeys.push(key);
        indexInGroup += 1;

        const src = `/user/images/${encodeURIComponent(g.folder)}/${encodeURIComponent(file)}`;
        const cap = `${g.name}${indexInGroup}`;

        const thumb = el('div', 'bbe-thumb');
        // 编号随时间递增，第 1 号是最早的那张
        thumb.title = `${cap}（点击选中）`;

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = src;
        img.alt = g.name;
        thumb.appendChild(img);

        // 点缩略图 = 切换选中，右侧同步预览
        thumb.addEventListener('click', () => {
          lastClickedKey = key;
          if (imageSelected.has(key)) imageSelected.delete(key);
          else imageSelected.add(key);
          refresh();
        });

        // 双击直接看大图（桌面端）
        thumb.addEventListener('dblclick', (e) => {
          e.preventDefault();
          lightbox.open(src, cap);
        });

        thumbsByKey.set(key, thumb);
        srcByKey.set(key, src);
        capByKey.set(key, cap);
        thumbs.appendChild(thumb);
      }

      gbox.addEventListener('change', () => {
        for (const key of groupKeys) {
          if (gbox.checked) imageSelected.add(key);
          else imageSelected.delete(key);
        }
        refresh();
      });

      groupEl.appendChild(thumbs);
      list.appendChild(groupEl);
    }

    allBtn.addEventListener('click', () => {
      allImages.forEach((it) => imageSelected.add(it.key));
      list.querySelectorAll('.bbe-group-head input').forEach((b) => (b.checked = true));
      refresh();
    });

    noneBtn.addEventListener('click', () => {
      imageSelected.clear();
      list.querySelectorAll('.bbe-group-head input').forEach((b) => (b.checked = false));
      refresh();
    });

    function pickedItems() {
      return allImages.filter((it) => imageSelected.has(it.key));
    }

    async function runTask(label, task) {
      dlBtn.disabled = true;
      zipBtn.disabled = true;
      const float = openFloatBar(label);
      try {
        await task(float);
      } catch (err) {
        float.fail(err?.message ?? String(err));
      } finally {
        dlBtn.disabled = imageSelected.size === 0;
        zipBtn.disabled = imageSelected.size === 0;
      }
    }

    dlBtn.addEventListener('click', async () => {
      const picked = pickedItems();
      if (!picked.length) return;
      await runTask('逐张下载', async (float) => {
        const result = await downloadImages(
          picked,
          ({ phase, done, total }) => {
            float.update(done, total, phase === 'download' ? '正在下载' : '');
          },
          float.signal,
        );
        if (result.aborted) float.aborted();
        else float.succeed(`已下载 ${result.count} 张`);
      });
    });

    zipBtn.addEventListener('click', async () => {
      const picked = pickedItems();
      if (!picked.length) return;
      await runTask('打包 ZIP', async (float) => {
        const result = await downloadImagesZip(
          picked,
          ({ phase, done, total }) => {
            if (phase === 'zip') float.update(total, total, '正在压缩');
            else if (phase === 'pack') float.update(done, total, '正在打包');
          },
          float.signal,
        );
        if (result.aborted) float.aborted();
        else if (result.count) float.succeed(`已打包 ${result.count} 张`);
        else float.fail('没有可取到的图片');
      });
    });

    refresh();
  }

  tabArtist.addEventListener('click', () => {
    if (mode === 'artist') return;
    mode = 'artist';
    renderArtist();
  });
  tabImage.addEventListener('click', () => {
    if (mode === 'image') return;
    mode = 'image';
    renderImage();
  });

  mask.appendChild(panel);
  document.body.appendChild(mask);
  renderArtist();
}

/** 导出单条。 */
function exportSingle(itemId) {
  const { items } = listArtistPresets();
  const item = items.find((it) => it.id === itemId);
  if (!item) return null;
  return formatMany([item]);
}

/* ===== src/index.js ===== */
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

})();

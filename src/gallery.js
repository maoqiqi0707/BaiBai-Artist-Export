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
export async function listGalleryGroups() {
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
export function imageUrl(folder, file) {
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
export async function downloadImages(selected, onProgress, signal) {
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
export async function downloadImagesZip(selected, onProgress, signal) {
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

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
export function listArtistPresets() {
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
export function readChannelDefaults() {
  const nai = readBaiBaiNaiSettings();
  return {
    quality: String(nai?.qualityTags ?? '').trim(),
    negative: String(nai?.undesiredContent ?? '').trim(),
  };
}

/** 单条格式化。四行「标签：内容」，空值写「无」，方便直接粘进文档。 */
export function formatOne(item) {
  return [
    `标题：${item.name}`,
    `画师串：${item.prompt || '无'}`,
    `正面质量词：${item.quality || '无'}`,
    `负面质量词：${item.negative || '无'}`,
  ].join('\n');
}

/** 多条格式化，条目之间空一行。 */
export function formatMany(items) {
  return items.map(formatOne).join('\n\n');
}

/** 触发浏览器下载。只生成文件，不碰任何插件数据。 */
export function downloadText(text, filename) {
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
export async function copyText(text) {
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

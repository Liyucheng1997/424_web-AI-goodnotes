// 手写字体与文字换行测量
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';

export const FONTS = {
  wenkai: { label: '霞鹜文楷', css: "'LXGW WenKai', KaiTi, 'Kaiti SC', serif", family: 'LXGW WenKai' },
  caveat: { label: 'Caveat + 文楷', css: "Caveat, 'LXGW WenKai', KaiTi, cursive", family: 'Caveat', scale: 1.12 },
  mashan: { label: '马善政毛笔', css: "'Ma Shan Zheng', 'LXGW WenKai', KaiTi, cursive", family: 'Ma Shan Zheng' },
  kuaile: { label: '站酷快乐体', css: "'ZCOOL KuaiLe', 'LXGW WenKai', cursive", family: 'ZCOOL KuaiLe' },
  sans: { label: '系统黑体', css: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif", family: null },
};

export function fontCss(key) {
  return (FONTS[key] || FONTS.wenkai).css;
}
/** 某些拉丁手写体字形偏小，按比例放大 */
export function fontScale(key) {
  return (FONTS[key] || FONTS.wenkai).scale || 1;
}

const SAMPLE = '永和九年岁在癸丑暮春之初会于会稽山阴之兰亭 Abc 123，。';
export async function ensureFont(key, sample = SAMPLE) {
  const f = FONTS[key] || FONTS.wenkai;
  const fams = [f.family, 'LXGW WenKai'].filter(Boolean);
  try {
    await Promise.all(fams.map((fam) => document.fonts.load(`20px "${fam}"`, sample)));
    await document.fonts.ready;
  } catch {
    /* 字体加载失败时退回系统字体 */
  }
}

let _ctx;
function ctx() {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  return _ctx;
}

export function measure(str, key, size) {
  const c = ctx();
  c.font = `${size * fontScale(key)}px ${fontCss(key)}`;
  return c.measureText(str).width;
}

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿‐-⁯←-⇿∀-⋿]/;
const NO_LINE_START = /^[，。、；：？！）」』》〉】,.;:?!)\]}%]/;

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (CJK.test(ch)) {
      out.push({ t: ch, i });
      i++;
    } else if (/\s/.test(ch)) {
      let j = i;
      while (j < s.length && /\s/.test(s[j]) && s[j] !== '\n') j++;
      if (j === i) j++;
      out.push({ t: s.slice(i, j), i, space: true });
      i = j;
    } else {
      let j = i;
      while (j < s.length && !CJK.test(s[j]) && !/\s/.test(s[j])) j++;
      out.push({ t: s.slice(i, j), i });
      i = j;
    }
  }
  return out;
}

/**
 * 换行。返回 [{ text, start }]，start 为该行在原字符串中的起始下标（用于定位荧光笔/划线位置）。
 */
export function wrapText(text, width, key, size) {
  const lines = [];
  const paras = String(text ?? '').split('\n');
  let offset = 0;
  for (const para of paras) {
    const toks = tokenize(para);
    let cur = '';
    let curStart = offset;
    for (const tok of toks) {
      const trial = cur + tok.t;
      if (cur && measure(trial.trimEnd(), key, size) > width && !NO_LINE_START.test(tok.t)) {
        lines.push({ text: cur.trimEnd(), start: curStart });
        if (tok.space) {
          cur = '';
          curStart = offset + tok.i + tok.t.length;
          continue;
        }
        // 过长的英文单词硬切
        if (measure(tok.t, key, size) > width) {
          let piece = '';
          let ps = offset + tok.i;
          for (let k = 0; k < tok.t.length; k++) {
            if (piece && measure(piece + tok.t[k], key, size) > width) {
              lines.push({ text: piece, start: ps });
              ps += piece.length;
              piece = '';
            }
            piece += tok.t[k];
          }
          cur = piece;
          curStart = ps;
          continue;
        }
        cur = tok.t;
        curStart = offset + tok.i;
      } else {
        if (!cur) curStart = offset + tok.i;
        cur = trial;
      }
    }
    lines.push({ text: cur.trimEnd(), start: curStart });
    offset += para.length + 1;
  }
  return lines;
}

/** 解析 ==荧光== 与 **划线** 标记，返回纯文本和标记区间 */
export function parseMarks(src) {
  let plain = '';
  const marks = [];
  const re = /(==([^=]+?)==|\*\*([^*]+?)\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    plain += src.slice(last, m.index);
    const inner = m[2] ?? m[3];
    const kind = m[2] != null ? 'highlight' : 'underline';
    marks.push({ kind, start: plain.length, end: plain.length + inner.length });
    plain += inner;
    last = m.index + m[0].length;
  }
  plain += src.slice(last);
  return { plain, marks };
}

// 康奈尔笔记的结构化输出 schema 与提示词

const str = { type: 'string' };
const strArr = { type: 'array', items: { type: 'string' } };

export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    keywords: strArr,
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cue: str,
          points: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: str,
                level: { type: 'integer' },
                kind: { type: 'string', enum: ['normal', 'key', 'example', 'warning', 'question'] },
              },
              required: ['text', 'level', 'kind'],
              additionalProperties: false,
            },
          },
          visual: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['none', 'flow', 'compare', 'mindmap'] },
              title: str,
              label_a: str,
              label_b: str,
              items: strArr,
              items_b: strArr,
            },
            required: ['type', 'title', 'label_a', 'label_b', 'items', 'items_b'],
            additionalProperties: false,
          },
        },
        required: ['cue', 'points', 'visual'],
        additionalProperties: false,
      },
    },
    summary: str,
  },
  required: ['title', 'keywords', 'sections', 'summary'],
  additionalProperties: false,
};

export function buildSystemPrompt() {
  return `你是一位擅长康奈尔笔记法（Cornell Notes）的学霸记录员。用户会给你一段语音识别得到的转录文本（课堂、讲座、会议或播客），你要把它整理成一页页可以“手写”在康奈尔笔记纸上的笔记。

康奈尔笔记纸分三块：左侧窄栏是“线索栏”（cue），右侧宽栏是“笔记栏”（points），底部是“总结栏”（summary）。你的输出会被逐字渲染成手写字体，画在纸面上，之后用户会自己修改，所以要像一个聪明的学生在纸上记的那样：

线索栏 cue
- 每个 section 一条，写成复习时能自测的问题或关键词，例如“为什么会通货膨胀？”“边际效用”。
- 尽量不超过 14 个汉字（或 6 个英文单词）。

笔记栏 points
- 用短语和要点，不写长段落；每条尽量不超过 40 个汉字。
- level 只能是 1（主要点）或 2（下一级补充，缩进显示）。
- kind：normal 普通要点；key 核心结论/定义（会用红笔写）；example 例子；warning 易错点/注意；question 讲者提出的问题或待查问题。
- 每个 section 用 ==双等号== 标出 1–2 个最关键的词（会被荧光笔涂黄），用 **双星号** 标出需要划线强调的短语（会画波浪线）。不要滥用。
- 可以使用 → ⇒ ∵ ∴ ≈ ≠ ↑ ↓ ✓ ✗ 等笔记符号来压缩表达。
- 公式用纯文本写，例如 E = mc²、Δx/Δt。

图示 visual（让笔记更像手绘）
- 大约每 2–3 个 section 配一个图示，其余写 type="none"。不要给每个 section 都配图。
- flow：流程/因果链，items 放 2–5 个步骤，每个不超过 8 个汉字。
- compare：两列对比，label_a / label_b 是两列标题，items / items_b 一一对应，每列 2–4 条，每条不超过 10 个汉字。
- mindmap：概念发散，title 是中心词（不超过 6 个汉字），items 是 3–5 个分支，每个不超过 8 个汉字。
- 用不到的字段填空字符串或空数组。

总结 summary
- 2–4 句话，用自己的话概括全篇的核心思想和最重要的结论，不超过 150 个汉字。

其他要求
- 转录可能有识别错误、口头禅和重复，请按上下文纠正明显的错别字，删掉“嗯、那个、对吧”这类口水话。
- 只依据转录内容记笔记，不要编造转录里没有的事实；如果你补充了必要的背景，用 kind="question" 并以“(补充)”开头。
- 中文内容一律输出简体中文（即使转录是繁体）。
- title：给整份笔记起一个简短标题（不超过 18 个汉字）。
- keywords：3–6 个关键词。`;
}

const DETAIL = {
  concise: '简洁：3–5 个 section，每个 2–4 条要点。',
  standard: '标准：5–8 个 section，每个 3–6 条要点。',
  detailed: '详细：8–14 个 section，每个 4–8 条要点，尽量保留例子、数据和推导过程。',
};

const LANG = {
  auto: '笔记语言跟随转录的主要语言。',
  zh: '笔记用简体中文书写（专有名词可保留英文）。',
  en: 'Write the notes in English.',
};

export function buildUserPrompt({ transcript, title, detail, language, instructions }) {
  const parts = [];
  parts.push(`详细程度：${DETAIL[detail] || DETAIL.standard}`);
  parts.push(LANG[language] || LANG.auto);
  if (title) parts.push(`用户给这段内容起的名字：${title}`);
  if (instructions && instructions.trim()) parts.push(`用户的额外要求：${instructions.trim()}`);
  parts.push(`下面是转录文本：\n<transcript>\n${transcript.trim()}\n</transcript>`);
  return parts.join('\n\n');
}

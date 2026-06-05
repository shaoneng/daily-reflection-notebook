import {
  appendReview,
  assertAuthorized,
  emptyMarkdown,
  error,
  getStore,
  json,
  mergeReviewTasks,
  noteKey,
  readTaskSuggestions,
  readTasks,
  stripReview,
  validateDate,
} from "../../_shared.js";

const REVIEW_LOOKBACK_DAYS = 7;
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

const REVIEW_MODES = {
  daily: {
    label: "每日",
    prompt: `你是一个每日复盘助手。只基于用户提供的 Markdown 记录，不编造事实。你会先查看近一周记录里是否有重复出现的事情、延续中的事情、相互关联的线索，再分析今天的记录。用中文输出，结构固定：
### 1. 今天的事实摘要
- ...
### 2. 近一周重复或关联的线索
- ...
### 3. 今天真正的行动主线
- ...
### 4. 卡点和消耗
- ...
### 5. 情绪与能量线索
- ...
### 6. 下一步建议
- ...
每一节最多 3 条。没有证据就明确说“近一周记录里暂时看不出”。建议必须和今天的事情及近一周线索相关，语言具体、克制、可执行。`,
  },
  learning: {
    label: "学习",
    prompt: `你是一个持续学习教练。只基于用户提供的 Markdown 记录，不编造事实。你的目标不是泛泛鼓励，而是帮助用户把每天的学习记录转化为可复用的知识、可追踪的卡点和明天可执行的练习。先对照近一周记录，找出重复学习主题、反复卡住的问题、正在形成的能力线索，再分析今天的记录。用中文输出，结构固定：
### 1. 今天学到的内容
- ...
### 2. 还没真正弄懂的问题
- ...
### 3. 可迁移的方法或经验
- ...
### 4. 近一周重复出现的学习线索
- ...
### 5. 明天最小练习
- ...
### 6. 需要回看或复习的旧内容
- ...
每一节最多 3 条。没有证据就明确说“记录里暂时看不出”。“明天最小练习”必须是 15 到 45 分钟内能完成的具体动作。“需要回看或复习的旧内容”必须来自今天或近一周记录，不要虚构材料。语言具体、克制、可执行。`,
  },
};

export async function onRequestPost(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");
  const mode = normalizeReviewMode(body.mode);

  const store = getStore(context);
  const key = noteKey(body.date);
  const markdown = (await store.get(key)) || emptyMarkdown(body.date);

  if (!stripReview(markdown).replace(`# ${body.date}`, "").trim()) {
    return error("今天还没有记录，先写一条再复盘。");
  }

  const recentRecords = await readRecentRecords(store, body.date);
  let result;
  try {
    result = await generateReview(context.env, body.date, markdown, recentRecords, mode);
  } catch (reviewError) {
    return error(reviewError.message || "AI 复盘失败。", 502);
  }

  const generatedAt = new Date().toISOString();
  const reviewLabel = [REVIEW_MODES[mode].label, providerLabel(result.provider)].filter(Boolean).join("｜");
  const reviewedMarkdown = appendReview(markdown, result.review, generatedAt, reviewLabel);
  const updatedMarkdown = mergeReviewTasks(reviewedMarkdown, result.review);
  await store.put(key, updatedMarkdown);

  return json({
    date: body.date,
    mode,
    provider: result.provider,
    model: result.model,
    review: result.review,
    tasks: readTasks(updatedMarkdown),
    suggestions: readTaskSuggestions(updatedMarkdown),
    markdown: updatedMarkdown,
  });
}

function normalizeReviewMode(mode) {
  return Object.prototype.hasOwnProperty.call(REVIEW_MODES, mode) ? mode : "learning";
}

function providerLabel(provider) {
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "workers-ai") return "Workers AI";
  if (provider === "openai") return "OpenAI";
  return "";
}

async function generateReview(env, date, markdown, recentRecords, mode) {
  const reviewMode = REVIEW_MODES[mode] || REVIEW_MODES.learning;
  const cleanTodayMarkdown = stripReview(markdown);
  const recentContext = formatRecentRecords(recentRecords, date);
  const userPrompt = `复盘模式：${reviewMode.label}
日期：${date}

今日 Markdown（已去除历史 AI 复盘）：
${cleanTodayMarkdown}

近一周记录（${REVIEW_LOOKBACK_DAYS} 天内，已去除历史 AI 复盘；用于寻找重复事项和关联线索）：
${recentContext}`;

  if (String(env.DEEPSEEK_API_KEY || "").trim()) {
    return generateDeepSeekReview(env, reviewMode.prompt, userPrompt);
  }

  if (mode === "learning") {
    throw new Error("学习复盘需要先配置 DeepSeek。请在 Cloudflare 环境变量里设置 DEEPSEEK_API_KEY，可选设置 DEEPSEEK_MODEL 和 DEEPSEEK_BASE_URL。");
  }

  if (env.AI && typeof env.AI.run === "function") {
    const model = env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: reviewMode.prompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = result?.response || result?.text || result?.content;
    if (text) return { provider: "workers-ai", model, review: text };
  }

  if (env.OPENAI_API_KEY && env.OPENAI_MODEL) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: reviewMode.prompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI 复盘请求失败。");
    }
    const text = data.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || "")
      ?.join("\n")
      ?.trim();
    if (data.output_text) return { provider: "openai", model: env.OPENAI_MODEL, review: data.output_text };
    if (text) return { provider: "openai", model: env.OPENAI_MODEL, review: text };
  }

  throw new Error("还没有配置 AI。请设置 DEEPSEEK_API_KEY，或绑定 Workers AI，或设置 OPENAI_API_KEY 和 OPENAI_MODEL。");
}

async function generateDeepSeekReview(env, systemPrompt, userPrompt) {
  const baseUrl = String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1800,
      stream: false,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "DeepSeek 复盘请求失败。");
  }
  const review = data.choices?.[0]?.message?.content?.trim();
  if (!review) throw new Error("DeepSeek 没有返回复盘内容。");
  return { provider: "deepseek", model, review };
}

async function readRecentRecords(store, date) {
  const dates = getRecentDates(date, REVIEW_LOOKBACK_DAYS);
  const records = await Promise.all(
    dates.map(async (recordDate) => {
      const markdown = await store.get(noteKey(recordDate));
      const cleaned = stripReview(markdown || emptyMarkdown(recordDate));
      const content = cleaned.replace(`# ${recordDate}`, "").trim();
      return content ? { date: recordDate, markdown: cleaned.trim() } : null;
    }),
  );
  return records.filter(Boolean);
}

function getRecentDates(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);
  return Array.from({ length: days }, (_, index) => {
    const offset = index - (days - 1);
    return formatDate(new Date(base + offset * 24 * 60 * 60 * 1000));
  });
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRecentRecords(records, today) {
  if (!records.length) return "近一周没有可用于对照的记录。";
  return records
    .map((record) => `## ${record.date}${record.date === today ? "（今天）" : ""}\n\n${record.markdown}`)
    .join("\n\n---\n\n");
}

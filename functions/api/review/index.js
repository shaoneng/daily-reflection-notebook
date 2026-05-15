import {
  appendReview,
  assertAuthorized,
  emptyMarkdown,
  error,
  getStore,
  json,
  noteKey,
  validateDate,
} from "../../_shared.js";

const SYSTEM_PROMPT = `你是一个每日复盘助手。只基于用户当天 Markdown 记录，不编造事实。用中文输出，结构固定：
### 1. 今天的事实摘要
- ...
### 2. 今天真正的行动主线
- ...
### 3. 卡点和消耗
- ...
### 4. 情绪与能量线索
- ...
### 5. 明天最小下一步
- ...
每一节最多 3 条，语言具体、克制、可执行。`;

export async function onRequestPost(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const markdown = (await store.get(key)) || emptyMarkdown(body.date);

  if (!markdown.replace(`# ${body.date}`, "").trim()) {
    return error("今天还没有记录，先写一条再复盘。");
  }

  const review = await generateReview(context.env, body.date, markdown);
  const generatedAt = new Date().toISOString();
  const updatedMarkdown = appendReview(markdown, review, generatedAt);
  await store.put(key, updatedMarkdown);

  return json({
    date: body.date,
    review,
    markdown: updatedMarkdown,
  });
}

async function generateReview(env, date, markdown) {
  const userPrompt = `日期：${date}

当天 Markdown：
${markdown}`;

  if (env.DEEPSEEK_API_KEY) {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-v4-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        max_tokens: 1800,
        stream: false,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || "DeepSeek 复盘请求失败。");
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  }

  if (env.AI && typeof env.AI.run === "function") {
    const model = env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const text = result?.response || result?.text || result?.content;
    if (text) return text;
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI 复盘请求失败。");
    }
    if (data.output_text) return data.output_text;
    const text = data.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || "")
      ?.join("\n")
      ?.trim();
    if (text) return text;
  }

  throw new Error("还没有配置 AI。请设置 DEEPSEEK_API_KEY，或绑定 Workers AI，或设置 OPENAI_API_KEY 和 OPENAI_MODEL。");
}

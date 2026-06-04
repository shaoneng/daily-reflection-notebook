const INDEX_KEY = "notes:index";
const TASK_MARKER = "\n\n---\n\n## 下一步追踪";
const REVIEW_MARKER = "\n\n---\n\n## AI 复盘";
const TASK_STATUS_LABELS = {
  todo: "今日待验证",
  next: "明日继续",
  done: "已完成",
  dropped: "已放弃",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function text(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function assertAuthorized(context) {
  const password = context.env.APP_PASSWORD;
  if (!password) return null;

  const authorization = context.request.headers.get("authorization") || "";
  if (authorization === `Bearer ${password}`) return null;
  return error("需要先在设置里输入访问口令。", 401);
}

export function getStore(context) {
  if (!context.env.NOTES_KV) {
    throw new Error("缺少 NOTES_KV 绑定。请在 Cloudflare Pages 里绑定 KV namespace。");
  }
  return context.env.NOTES_KV;
}

export function noteKey(date) {
  return `note:${date}`;
}

export function validateDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function emptyMarkdown(date) {
  return `# ${date}\n\n`;
}

export function stripReview(markdown) {
  const index = markdown.indexOf(REVIEW_MARKER);
  if (index === -1) return markdown;
  return markdown.slice(0, index).trimEnd() + "\n\n";
}

export function stripTasks(markdown) {
  const reviewIndex = markdown.indexOf(REVIEW_MARKER);
  const beforeReview = reviewIndex === -1 ? markdown : markdown.slice(0, reviewIndex);
  const review = reviewIndex === -1 ? "" : markdown.slice(reviewIndex);
  const taskIndex = beforeReview.indexOf(TASK_MARKER);
  if (taskIndex === -1) return markdown;
  return `${beforeReview.slice(0, taskIndex).trimEnd()}\n\n${review.trimStart()}`.trimEnd() + "\n\n";
}

export function appendEntry(markdown, entry) {
  const base = stripReview(markdown || emptyMarkdown(entry.date));
  const safeContent = String(entry.content || "").trim();
  const timezone = String(entry.timezone || "local");
  const time = String(entry.time || "");
  const block = `## ${time}（${timezone}）\n\n${safeContent}\n\n`;
  return `${base.trimEnd()}\n\n${block}`;
}

export function removeEntryAt(markdown, date, entryIndex) {
  const base = stripReview(markdown || emptyMarkdown(date));
  const lines = base.split("\n");
  const starts = [];

  lines.forEach((line, index) => {
    if (/^##\s+/.test(line) && !line.startsWith("## AI 复盘") && !line.startsWith("## 下一步追踪")) starts.push(index);
  });

  if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= starts.length) {
    throw new Error("没有找到要删除的记录。");
  }

  const start = starts[entryIndex];
  const end = starts[entryIndex + 1] ?? lines.length;
  lines.splice(start, end - start);

  const cleaned = lines.join("\n").trimEnd();
  if (!starts.length || !cleaned.replace(/^#\s+[^\n]+\n*/, "").trim()) {
    return emptyMarkdown(date);
  }
  return `${cleaned}\n\n`;
}

export function appendReview(markdown, review, generatedAt, modeLabel = "") {
  const base = stripReview(markdown);
  const label = modeLabel ? `${modeLabel}｜` : "";
  return `${base.trimEnd()}${REVIEW_MARKER}（${label}${generatedAt}）\n\n${String(review).trim()}\n`;
}

export function readTasks(markdown) {
  const base = stripReview(markdown || "");
  const taskIndex = base.indexOf(TASK_MARKER);
  if (taskIndex === -1) return [];
  const taskSection = base.slice(taskIndex + TASK_MARKER.length);
  const lines = taskSection.split("\n");
  const tasks = [];

  for (const line of lines) {
    const match = line.match(/^-\s+\[([a-z]+)\]\s+(.+)$/);
    if (!match) continue;
    const status = normalizeTaskStatus(match[1]);
    const content = match[2].trim();
    if (!content) continue;
    tasks.push({
      index: tasks.length,
      status,
      label: TASK_STATUS_LABELS[status],
      content,
    });
  }

  return tasks;
}

export function writeTasks(markdown, tasks) {
  const reviewIndex = markdown.indexOf(REVIEW_MARKER);
  const withoutReview = reviewIndex === -1 ? markdown : markdown.slice(0, reviewIndex);
  const review = reviewIndex === -1 ? "" : markdown.slice(reviewIndex);
  const withoutTasks = stripTasks(withoutReview).trimEnd();
  const cleanTasks = tasks
    .map((task) => ({
      status: normalizeTaskStatus(task.status),
      content: String(task.content || "").trim(),
    }))
    .filter((task) => task.content);
  const taskBlock = cleanTasks.length
    ? `${TASK_MARKER}\n\n${cleanTasks.map((task) => `- [${task.status}] ${task.content}`).join("\n")}\n`
    : "";
  return `${withoutTasks}${taskBlock}${review ? `\n\n${review.trimStart()}` : "\n"}`;
}

export function appendTask(markdown, task) {
  const tasks = readTasks(markdown);
  const content = String(task.content || "").trim();
  if (!content) throw new Error("下一步内容不能为空。");
  tasks.push({
    status: normalizeTaskStatus(task.status),
    content,
  });
  return writeTasks(markdown, tasks);
}

export function updateTaskAt(markdown, taskIndex, patch) {
  const tasks = readTasks(markdown);
  if (!Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= tasks.length) {
    throw new Error("没有找到要更新的下一步。");
  }
  tasks[taskIndex] = {
    ...tasks[taskIndex],
    ...patch,
    status: normalizeTaskStatus(patch.status || tasks[taskIndex].status),
    content: String(patch.content ?? tasks[taskIndex].content).trim(),
  };
  return writeTasks(markdown, tasks);
}

export function removeTaskAt(markdown, taskIndex) {
  const tasks = readTasks(markdown);
  if (!Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= tasks.length) {
    throw new Error("没有找到要删除的下一步。");
  }
  tasks.splice(taskIndex, 1);
  return writeTasks(markdown, tasks);
}

export function mergeReviewTasks(markdown, review) {
  const existing = readTasks(markdown);
  const seen = new Set(existing.map((task) => normalizeTaskContent(task.content)));
  const extracted = extractReviewTasks(review).filter((content) => {
    const key = normalizeTaskContent(content);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!extracted.length) return markdown;
  return writeTasks(markdown, [
    ...existing,
    ...extracted.map((content) => ({
      status: "todo",
      content,
    })),
  ]);
}

export function normalizeTaskStatus(status) {
  return Object.prototype.hasOwnProperty.call(TASK_STATUS_LABELS, status) ? status : "todo";
}

export function taskStatusLabels() {
  return TASK_STATUS_LABELS;
}

function extractReviewTasks(review) {
  const lines = String(review || "").split("\n");
  const tasks = [];
  let active = false;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      active = /下一步|最小练习|待验证|继续|回看|复习/.test(line);
      continue;
    }
    if (!active || !line.startsWith("- ")) continue;
    const content = line.slice(2).trim();
    if (content && !/^记录里暂时看不出/.test(content)) tasks.push(content);
  }

  return tasks.slice(0, 5);
}

function normalizeTaskContent(content) {
  return String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function readIndex(store) {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return { dates: [] };
  try {
    const parsed = JSON.parse(raw);
    return { dates: Array.isArray(parsed.dates) ? parsed.dates : [] };
  } catch {
    return { dates: [] };
  }
}

export async function addDateToIndex(store, date) {
  const index = await readIndex(store);
  if (!index.dates.includes(date)) {
    index.dates.push(date);
    index.dates.sort().reverse();
    await store.put(INDEX_KEY, JSON.stringify(index));
  }
}

export function extractTags(markdown) {
  const tags = new Set();
  const matches = String(markdown).matchAll(/(^|[\s([{，。；：])#([\p{L}\p{N}_-]{1,32})/gu);
  for (const match of matches) tags.add(match[2]);
  return [...tags].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function makeSnippet(markdown, query) {
  const compact = String(markdown).replace(/\s+/g, " ").trim();
  const normalized = query.toLowerCase();
  const index = compact.toLowerCase().indexOf(normalized);
  if (index === -1) return compact.slice(0, 140);
  const start = Math.max(0, index - 42);
  const end = Math.min(compact.length, index + normalized.length + 90);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

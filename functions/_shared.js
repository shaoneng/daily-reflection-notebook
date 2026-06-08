const INDEX_KEY = "notes:index";
const SUGGESTION_MARKER = "\n\n---\n\n## AI 建议待确认";
const TASK_MARKER = "\n\n---\n\n## 下一步追踪";
const REVIEW_MARKER = "\n\n---\n\n## AI 复盘";
const TASK_STATUS_LABELS = {
  todo: "今日待验证",
  next: "明日继续",
  done: "已完成",
  dropped: "已放弃",
};
const TASK_ACTION_HINTS = [
  "完成", "写", "整理", "复盘", "回看", "复习", "练习", "对照", "拆解", "验证", "测试", "记录", "列出",
  "读", "重读", "看", "找出", "输出", "提交", "更新", "修改", "做", "尝试", "用", "把", "给",
];
const WEAK_SUGGESTION_PATTERNS = [
  /^继续(学习|研究|关注|思考|推进)?$/,
  /^进一步(学习|研究|优化|完善|推进)?$/,
  /^保持(学习|记录|复盘|关注)?$/,
  /^加强(学习|理解|练习)?$/,
  /^提升(能力|效率|认知|理解)?$/,
  /^多(学习|练习|复盘|总结)$/,
  /^做好(规划|复盘|总结)?$/,
  /^持续(学习|记录|优化|改进)?$/,
];

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
  const suggestionIndex = beforeReview.indexOf(SUGGESTION_MARKER, taskIndex + TASK_MARKER.length);
  const endIndex = suggestionIndex === -1 ? beforeReview.length : suggestionIndex;
  return `${beforeReview.slice(0, taskIndex).trimEnd()}\n\n${beforeReview.slice(endIndex).trimStart()}${review ? `\n\n${review.trimStart()}` : ""}`.trimEnd() + "\n\n";
}

export function stripSuggestions(markdown) {
  const reviewIndex = markdown.indexOf(REVIEW_MARKER);
  const beforeReview = reviewIndex === -1 ? markdown : markdown.slice(0, reviewIndex);
  const review = reviewIndex === -1 ? "" : markdown.slice(reviewIndex);
  const suggestionIndex = beforeReview.indexOf(SUGGESTION_MARKER);
  if (suggestionIndex === -1) return markdown;
  const taskIndex = beforeReview.indexOf(TASK_MARKER);
  const endIndex = taskIndex !== -1 && taskIndex > suggestionIndex ? taskIndex : beforeReview.length;
  return `${beforeReview.slice(0, suggestionIndex).trimEnd()}\n\n${beforeReview.slice(endIndex).trimStart()}${review ? `\n\n${review.trimStart()}` : ""}`.trimEnd() + "\n\n";
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
  const taskSection = readMarkdownSection(base, "下一步追踪", ["AI 建议待确认"]);
  return parseTrackedItems(taskSection, "task").map((task, index) => ({
    ...task,
    index,
    label: TASK_STATUS_LABELS[task.status],
  }));
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
      source: String(task.source || "").trim(),
      result: String(task.result || "").trim(),
      reason: String(task.reason || "").trim(),
      carriedFrom: String(task.carriedFrom || "").trim(),
    }))
    .filter((task) => task.content);
  const taskBlock = cleanTasks.length
    ? `${TASK_MARKER}\n\n${cleanTasks.map(formatTaskMarkdown).join("\n")}\n`
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
    source: String(task.source || "").trim(),
    carriedFrom: String(task.carriedFrom || "").trim(),
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
    source: String(patch.source ?? tasks[taskIndex].source ?? "").trim(),
    result: String(patch.result ?? tasks[taskIndex].result ?? "").trim(),
    reason: String(patch.reason ?? tasks[taskIndex].reason ?? "").trim(),
    carriedFrom: String(patch.carriedFrom ?? tasks[taskIndex].carriedFrom ?? "").trim(),
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
  const existingTasks = readTasks(markdown);
  const existingSuggestions = readTaskSuggestions(markdown);
  const extracted = dedupeTaskSuggestions([
    ...existingSuggestions,
    ...extractReviewSuggestions(review),
  ], existingTasks);
  return writeTaskSuggestions(markdown, extracted);
}

export function readTaskSuggestions(markdown) {
  const base = stripReview(markdown || "");
  const suggestionSection = readMarkdownSection(base, "AI 建议待确认", ["下一步追踪"]);
  return parseTrackedItems(suggestionSection, "suggestion").map((suggestion, index) => ({
    ...suggestion,
    index,
  }));
}

export function writeTaskSuggestions(markdown, suggestions) {
  const reviewIndex = markdown.indexOf(REVIEW_MARKER);
  const withoutReview = reviewIndex === -1 ? markdown : markdown.slice(0, reviewIndex);
  const review = reviewIndex === -1 ? "" : markdown.slice(reviewIndex);
  const withoutSuggestions = stripSuggestions(withoutReview).trimEnd();
  const cleanSuggestions = suggestions
    .map((suggestion) => ({
      content: String(suggestion.content || "").trim(),
      source: String(suggestion.source || "").trim(),
    }))
    .filter((suggestion) => suggestion.content);
  const suggestionBlock = cleanSuggestions.length
    ? `${SUGGESTION_MARKER}\n\n${cleanSuggestions.map(formatSuggestionMarkdown).join("\n")}\n`
    : "";
  return `${withoutSuggestions}${suggestionBlock}${review ? `\n\n${review.trimStart()}` : "\n"}`;
}

export function acceptTaskSuggestion(markdown, suggestionIndex, content) {
  const suggestions = readTaskSuggestions(markdown);
  if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
    throw new Error("没有找到要采纳的 AI 建议。");
  }
  const suggestion = suggestions[suggestionIndex];
  const taskContent = String(content ?? suggestion.content).trim();
  if (!taskContent) throw new Error("下一步内容不能为空。");
  suggestions.splice(suggestionIndex, 1);
  const withoutSuggestion = writeTaskSuggestions(markdown, suggestions);
  return appendTask(withoutSuggestion, {
    status: "todo",
    content: taskContent,
    source: suggestion.source || "AI 建议",
  });
}

export function removeTaskSuggestionAt(markdown, suggestionIndex) {
  const suggestions = readTaskSuggestions(markdown);
  if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
    throw new Error("没有找到要忽略的 AI 建议。");
  }
  suggestions.splice(suggestionIndex, 1);
  return writeTaskSuggestions(markdown, suggestions);
}

export function extractOpenTasks(markdown) {
  return readTasks(markdown).filter((task) => task.status === "todo" || task.status === "next");
}

export function mergeCarriedTasks(markdown, tasks, fromDate) {
  const existing = readTasks(markdown);
  const seen = new Set(existing.map((task) => normalizeTaskContent(task.content)));
  const carried = tasks.filter((task) => {
    if (task.status !== "todo" && task.status !== "next") return false;
    const key = normalizeTaskContent(task.content);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!carried.length) return markdown;
  return writeTasks(markdown, [...existing, ...carried.map((task) => ({
    status: "next",
    content: task.content,
    source: `从 ${fromDate} 带入`,
    carriedFrom: fromDate,
  }))]);
}

export function normalizeTaskStatus(status) {
  return Object.prototype.hasOwnProperty.call(TASK_STATUS_LABELS, status) ? status : "todo";
}

export function taskStatusLabels() {
  return TASK_STATUS_LABELS;
}

function extractReviewTasks(review) {
  return extractReviewSuggestions(review).map((suggestion) => suggestion.content);
}

function extractReviewSuggestions(review) {
  const lines = String(review || "").split("\n");
  const suggestions = [];
  let active = false;
  let section = "";

  for (const line of lines) {
    if (line.startsWith("### ")) {
      active = /下一步|最小练习|待验证|继续|回看|复习/.test(line);
      section = line.slice(4).replace(/^\d+\.\s*/, "").trim();
      continue;
    }
    if (!active || !line.startsWith("- ")) continue;
    const content = cleanSuggestionContent(line.slice(2));
    if (isActionableSuggestion(content)) {
      suggestions.push({
        content,
        source: section ? `AI 复盘 / ${section}` : "AI 复盘",
      });
    }
  }

  return dedupeTaskSuggestions(suggestions).slice(0, 5);
}

function dedupeTaskSuggestions(suggestions, existingTasks = []) {
  const seen = new Set(existingTasks.map((task) => taskSignature(task.content)));
  const existingContents = existingTasks.map((task) => task.content);
  const accepted = [];

  for (const suggestion of suggestions) {
    const content = cleanSuggestionContent(suggestion.content);
    if (!isActionableSuggestion(content)) continue;

    const signature = taskSignature(content);
    if (!signature || seen.has(signature)) continue;
    if (existingContents.some((taskContent) => areSimilarTasks(taskContent, content))) continue;

    const similarIndex = accepted.findIndex((item) => areSimilarTasks(item.content, content));
    if (similarIndex >= 0) {
      if (scoreSuggestionQuality(content) > scoreSuggestionQuality(accepted[similarIndex].content)) {
        accepted[similarIndex] = {
          content,
          source: mergeSuggestionSources(accepted[similarIndex].source, suggestion.source),
        };
      } else {
        accepted[similarIndex].source = mergeSuggestionSources(accepted[similarIndex].source, suggestion.source);
      }
      seen.add(signature);
      continue;
    }

    seen.add(signature);
    accepted.push({
      content,
      source: String(suggestion.source || "").trim(),
    });
  }

  return accepted.slice(0, 5);
}

function cleanSuggestionContent(content) {
  return String(content || "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+[.)、]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isActionableSuggestion(content) {
  const value = cleanSuggestionContent(content);
  if (!value) return false;
  if (/^(记录里暂时看不出|近一周记录里暂时看不出|暂无|无|没有证据)/.test(value)) return false;
  if (value.length < 8 || value.length > 120) return false;
  if (WEAK_SUGGESTION_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (!TASK_ACTION_HINTS.some((hint) => value.includes(hint))) return false;
  return true;
}

function scoreSuggestionQuality(content) {
  const value = cleanSuggestionContent(content);
  let score = Math.min(value.length, 80);
  if (/\d+\s*(分钟|小时|天|个|条|遍|次|步|页)/.test(value)) score += 28;
  if (/今天|明天|早起后|上午|下午|晚上|下一次|本周/.test(value)) score += 16;
  if (/完成即停|交给|输出|写出|列出|标出|对照/.test(value)) score += 12;
  if (/继续|进一步|加强|提升|完善/.test(value)) score -= 18;
  return score;
}

function taskSignature(content) {
  return normalizeTaskContent(content)
    .replace(/[，。！？、；：,.!?;:"'“”‘’（）()【】[\]\s]/g, "")
    .replace(/\d+/g, "#")
    .replace(/今天|明天|本周|下一次|早起后|上午|下午|晚上/g, "");
}

function areSimilarTasks(a, b) {
  const left = taskSignature(a);
  const right = taskSignature(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.length >= 12 && (left.includes(right) || right.includes(left))) return true;

  const leftTokens = taskTokens(left);
  const rightTokens = taskTokens(right);
  const tokenOverlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  if (leftTokens.length && rightTokens.length && tokenOverlap / Math.min(leftTokens.length, rightTokens.length) >= 0.72) {
    return true;
  }

  const leftBigrams = characterBigrams(left);
  const rightBigrams = characterBigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) return false;
  const rightSet = new Set(rightBigrams);
  const overlap = leftBigrams.filter((item) => rightSet.has(item)).length;
  return overlap / Math.min(leftBigrams.length, rightBigrams.length) >= 0.62;
}

function taskTokens(value) {
  return String(value || "")
    .split(/[#/\-|_]+/)
    .flatMap((part) => part.match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter((token) => token.length >= 2);
}

function characterBigrams(value) {
  const compact = String(value || "").replace(/[^\p{L}\p{N}#]/gu, "");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

function mergeSuggestionSources(a, b) {
  const sources = [a, b].map((source) => String(source || "").trim()).filter(Boolean);
  return [...new Set(sources)].slice(0, 2).join("；");
}

function parseTrackedItems(section, type) {
  const lines = String(section || "").split("\n");
  const items = [];
  let current = null;

  for (const line of lines) {
    const itemMatch = line.match(/^-\s+\[([a-z]+)\]\s+(.+)$/);
    if (itemMatch) {
      current = {
        status: type === "task" ? normalizeTaskStatus(itemMatch[1]) : itemMatch[1],
        content: itemMatch[2].trim(),
      };
      if (current.content) items.push(current);
      continue;
    }

    const metaMatch = line.match(/^\s{2,}-\s+([^：:]+)[：:]\s*(.+)$/);
    if (!current || !metaMatch) continue;
    const key = metaMatch[1].trim();
    const value = metaMatch[2].trim();
    if (key === "来源") current.source = value;
    if (key === "结果") current.result = value;
    if (key === "原因") current.reason = value;
    if (key === "带入自") current.carriedFrom = value;
  }

  return items;
}

function readMarkdownSection(markdown, heading, nextHeadings = []) {
  const lines = String(markdown || "").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.+)$/);
    if (match && (!nextHeadings.length || nextHeadings.includes(match[1].trim()))) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function formatTaskMarkdown(task) {
  return [
    `- [${task.status}] ${task.content}`,
    task.source ? `  - 来源：${task.source}` : "",
    task.carriedFrom ? `  - 带入自：${task.carriedFrom}` : "",
    task.result ? `  - 结果：${task.result}` : "",
    task.reason ? `  - 原因：${task.reason}` : "",
  ].filter(Boolean).join("\n");
}

function formatSuggestionMarkdown(suggestion) {
  return [
    `- [pending] ${suggestion.content}`,
    suggestion.source ? `  - 来源：${suggestion.source}` : "",
  ].filter(Boolean).join("\n");
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

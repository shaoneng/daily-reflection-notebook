const state = {
  selectedDate: toLocalDate(new Date()),
  password: localStorage.getItem("dailyNotebookPassword") || "",
};

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  entryInput: document.querySelector("#entryInput"),
  saveButton: document.querySelector("#saveButton"),
  reviewButton: document.querySelector("#reviewButton"),
  timelineList: document.querySelector("#timelineList"),
  entryCount: document.querySelector("#entryCount"),
  lastSavedAt: document.querySelector("#lastSavedAt"),
  markdownView: document.querySelector("#markdownView"),
  noteTitle: document.querySelector("#noteTitle"),
  datePicker: document.querySelector("#datePicker"),
  exportLink: document.querySelector("#exportLink"),
  reviewOutput: document.querySelector("#reviewOutput"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  searchResults: document.querySelector("#searchResults"),
  tagList: document.querySelector("#tagList"),
  tabButtons: document.querySelectorAll("[data-view-target]"),
  viewPanels: document.querySelectorAll("[data-view-panel]"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  passwordInput: document.querySelector("#passwordInput"),
  savePasswordButton: document.querySelector("#savePasswordButton"),
};

init();

function init() {
  els.datePicker.value = state.selectedDate;
  els.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  els.passwordInput.value = state.password;
  bindEvents();
  refreshDay();
  refreshTags();
}

function bindEvents() {
  els.saveButton.addEventListener("click", saveEntry);
  els.reviewButton.addEventListener("click", runReview);
  els.exportLink.addEventListener("click", exportMarkdown);
  els.datePicker.addEventListener("change", () => {
    state.selectedDate = els.datePicker.value || toLocalDate(new Date());
    refreshDay();
    activateView("today");
  });
  els.searchButton.addEventListener("click", runSearch);
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  els.entryInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveEntry();
  });
  els.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    state.selectedDate = button.dataset.date;
    els.datePicker.value = state.selectedDate;
    refreshDay();
    activateView("today");
  });
  els.timelineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-index]");
    if (!button) return;
    deleteEntry(Number(button.dataset.entryIndex));
  });
  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.viewTarget));
  });
  els.settingsButton.addEventListener("click", () => {
    els.passwordInput.value = state.password;
    els.settingsDialog.showModal();
  });
  els.savePasswordButton.addEventListener("click", () => {
    state.password = els.passwordInput.value.trim();
    localStorage.setItem("dailyNotebookPassword", state.password);
    setStatus("口令已保存");
  });
}

async function exportMarkdown(event) {
  event.preventDefault();
  try {
    const headers = {};
    if (state.password) headers.authorization = `Bearer ${state.password}`;
    const response = await fetch(`/api/export?date=${encodeURIComponent(state.selectedDate)}`, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "导出失败。");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.selectedDate}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(error);
  }
}

async function refreshDay() {
  setStatus("同步中");
  els.noteTitle.textContent = state.selectedDate;
  els.exportLink.href = `/api/export?date=${encodeURIComponent(state.selectedDate)}`;
  try {
    const data = await api(`/api/day?date=${encodeURIComponent(state.selectedDate)}`);
    renderDay(data.markdown || emptyMarkdown(state.selectedDate));
    setStatus(data.exists ? "已同步" : "新日期");
  } catch (error) {
    showError(error);
  }
}

async function saveEntry() {
  const content = els.entryInput.value.trim();
  if (!content) {
    setStatus("先写一条");
    els.entryInput.focus();
    return;
  }

  setBusy(true);
  setStatus("保存中");
  try {
    const now = new Date();
    const payload = {
      date: toLocalDate(now),
      time: toLocalTime(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      content,
    };
    state.selectedDate = payload.date;
    els.datePicker.value = payload.date;
    const data = await api("/api/day", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderDay(data.markdown);
    els.entryInput.value = "";
    setStatus(`已保存 ${payload.time}`);
    activateView("today");
    refreshTags();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runReview() {
  setBusy(true);
  activateView("review");
  els.reviewOutput.innerHTML = "<p>正在复盘今天的记录...</p>";
  try {
    const data = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({
        date: state.selectedDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      }),
    });
    renderReview(data.review);
    renderDay(data.markdown, { keepReview: true });
    setStatus("复盘完成");
  } catch (error) {
    showError(error);
    els.reviewOutput.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    setBusy(false);
  }
}

async function deleteEntry(entryIndex) {
  if (!Number.isInteger(entryIndex)) return;
  const confirmed = window.confirm("确定删除这条记录吗？删除后，今天的 AI 复盘也会清空，需要重新生成。");
  if (!confirmed) return;

  setBusy(true);
  setStatus("删除中");
  try {
    const data = await api("/api/day", {
      method: "DELETE",
      body: JSON.stringify({
        date: state.selectedDate,
        entryIndex,
      }),
    });
    renderDay(data.markdown);
    setStatus("已删除");
    activateView("today");
    refreshTags();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runSearch(queryOverride) {
  const q = (queryOverride || els.searchInput.value).trim();
  if (!q) return;
  activateView("search");
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    els.searchResults.innerHTML = data.results.length
      ? data.results.map(renderResult).join("")
      : "<p>没有找到相关记录。</p>";
  } catch (error) {
    showError(error);
  }
}

async function refreshTags() {
  try {
    const data = await api("/api/tags");
    els.tagList.innerHTML = data.tags.length
      ? data.tags.map((tag) => `<button class="tag-button" type="button" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</button>`).join("")
      : "<p>还没有标签。</p>";
    els.tagList.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const tag = `#${button.dataset.tag}`;
        els.searchInput.value = tag;
        runSearch(tag);
      });
    });
  } catch (error) {
    els.tagList.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (state.password) headers.authorization = `Bearer ${state.password}`;
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "请求失败" };
  }
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function renderDay(markdown, options = {}) {
  const entries = parseEntries(markdown);
  const review = parseLatestReview(markdown);
  els.markdownView.textContent = markdown;
  els.entryCount.textContent = `${entries.length} 条记录`;
  els.lastSavedAt.textContent = entries.length ? `最近 ${entries.at(-1).time}` : "今天还没有开始";
  els.timelineList.innerHTML = entries.length
    ? entries.map(renderTimelineItem).join("")
    : '<div class="empty-state">还没有记录。先在左侧写一条，今天就开始有形状了。</div>';
  if (review && !options.keepReview) renderReview(review);
  if (!review && !options.keepReview) resetReviewOutput();
}

function renderTimelineItem(entry) {
  const tags = extractTags(entry.content);
  return `
    <article class="timeline-item">
      <time class="timeline-time">${escapeHtml(entry.time)}</time>
      <div class="timeline-content">
        <p>${escapeHtml(entry.content)}</p>
        ${tags.length ? `<div class="inline-tags">${tags.map((tag) => `<span class="inline-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </div>
      <button class="delete-entry-button" type="button" data-entry-index="${entry.index}" aria-label="删除 ${escapeAttr(entry.time)} 的记录" title="删除这条记录">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </article>
  `;
}

function parseEntries(markdown) {
  const lines = markdown.split("\n");
  const entries = [];
  let current = null;
  let entryIndex = 0;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) entries.push(normalizeEntry(current));
      if (heading[1].startsWith("AI 复盘")) {
        current = null;
        break;
      }
      current = { heading: heading[1], index: entryIndex, lines: [] };
      entryIndex += 1;
      continue;
    }
    if (!current || line.trim() === "---") continue;
    current.lines.push(line);
  }

  if (current) entries.push(normalizeEntry(current));
  return entries.filter((entry) => entry.content);
}

function normalizeEntry(entry) {
  const content = entry.lines.join("\n").trim();
  return {
    index: entry.index,
    time: formatEntryTime(entry.heading),
    content,
  };
}

function formatEntryTime(heading) {
  const match = heading.match(/\d{2}:\d{2}/);
  return match ? match[0] : heading;
}

function parseLatestReview(markdown) {
  const reviewIndex = markdown.lastIndexOf("## AI 复盘");
  if (reviewIndex === -1) return "";
  return markdown.slice(reviewIndex).replace(/^## AI 复盘[^\n]*\n?/, "").trim();
}

function renderReview(markdown) {
  els.reviewOutput.innerHTML = markdownToHtml(markdown);
}

function resetReviewOutput() {
  els.reviewOutput.innerHTML = "<p>点击“复盘”后，会根据当天记录生成：事实摘要、行动主线、卡点、情绪/能量、下一步。</p>";
}

function extractTags(content) {
  return Array.from(new Set(content.match(/#[^\s#，。,.；;！!？?、）)（(]+/g) || []));
}

function renderResult(result) {
  return `
    <button class="result-item" type="button" data-date="${escapeAttr(result.date)}">
      <strong>${escapeHtml(result.date)}</strong>
      <span>${escapeHtml(result.snippet)}</span>
    </button>
  `;
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else if (line.trim()) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || "<p>没有复盘内容。</p>";
}

function activateView(name) {
  els.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === name);
  });
  els.viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === name);
  });
}

function setBusy(isBusy) {
  els.saveButton.disabled = isBusy;
  els.reviewButton.disabled = isBusy;
  els.timelineList.querySelectorAll("[data-entry-index]").forEach((button) => {
    button.disabled = isBusy;
  });
}

function setStatus(message) {
  els.syncStatus.textContent = message;
}

function showError(error) {
  console.error(error);
  setStatus("出错");
  els.timelineList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  els.markdownView.textContent = error.message;
}

function emptyMarkdown(date) {
  return `# ${date}\n\n`;
}

function toLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

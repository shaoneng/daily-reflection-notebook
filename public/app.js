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
  markdownView: document.querySelector("#markdownView"),
  noteTitle: document.querySelector("#noteTitle"),
  datePicker: document.querySelector("#datePicker"),
  exportLink: document.querySelector("#exportLink"),
  reviewOutput: document.querySelector("#reviewOutput"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  searchResults: document.querySelector("#searchResults"),
  tagList: document.querySelector("#tagList"),
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
  });
  els.searchButton.addEventListener("click", runSearch);
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  els.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    state.selectedDate = button.dataset.date;
    els.datePicker.value = state.selectedDate;
    refreshDay();
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
    els.markdownView.textContent = data.markdown || emptyMarkdown(state.selectedDate);
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
    els.markdownView.textContent = data.markdown;
    els.entryInput.value = "";
    setStatus("已保存");
    refreshTags();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runReview() {
  setBusy(true);
  els.reviewOutput.innerHTML = "<p>正在复盘今天的 Markdown...</p>";
  try {
    const data = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({
        date: state.selectedDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      }),
    });
    els.reviewOutput.innerHTML = markdownToHtml(data.review);
    els.markdownView.textContent = data.markdown;
    setStatus("复盘完成");
  } catch (error) {
    showError(error);
    els.reviewOutput.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    setBusy(false);
  }
}

async function runSearch(queryOverride) {
  const q = (queryOverride || els.searchInput.value).trim();
  if (!q) return;
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

function setBusy(isBusy) {
  els.saveButton.disabled = isBusy;
  els.reviewButton.disabled = isBusy;
}

function setStatus(message) {
  els.syncStatus.textContent = message;
}

function showError(error) {
  console.error(error);
  setStatus("出错");
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

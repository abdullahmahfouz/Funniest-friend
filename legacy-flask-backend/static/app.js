const chatSelect = document.getElementById("chat-select");
const refreshBtn = document.getElementById("refresh-btn");
const errorBanner = document.getElementById("error-banner");
const leaderboardSection = document.getElementById("leaderboard");
const chatMeta = document.getElementById("chat-meta");
const board = document.getElementById("board");
const analyzeSection = document.getElementById("analyze-section");
const analyzeBtn = document.getElementById("analyze-btn");
const analysis = document.getElementById("analysis");
const funniestCard = document.getElementById("funniest-card");
const superlativesEl = document.getElementById("superlatives");
const closingLineEl = document.getElementById("closing-line");

let currentChat = null;

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || ("Request failed: " + res.status));
  }
  return data;
}

async function loadChats() {
  chatSelect.innerHTML = '<option value="">Loading group chats…</option>';
  try {
    const chats = await fetchJSON("/api/chats");
    if (!chats.length) {
      chatSelect.innerHTML = '<option value="">No group chats found</option>';
      return;
    }
    chatSelect.innerHTML = '<option value="">Pick a group chat…</option>' +
      chats.map(c => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)} (${c.messages} msgs, ${c.participants} people)</option>`).join("");
    clearError();
  } catch (err) {
    chatSelect.innerHTML = '<option value="">Failed to load chats</option>';
    showError(err.message);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function medalClass(i) {
  if (i === 0) return "gold";
  if (i === 1) return "silver";
  if (i === 2) return "bronze";
  return "";
}

async function loadStats(chatName) {
  analyzeSection.classList.add("hidden");
  analysis.classList.add("hidden");
  try {
    const data = await fetchJSON("/api/stats?chat=" + encodeURIComponent(chatName));
    clearError();
    renderLeaderboard(data.stats);
    analyzeSection.classList.remove("hidden");
  } catch (err) {
    leaderboardSection.classList.add("hidden");
    showError(err.message);
  }
}

function renderLeaderboard(stats) {
  chatMeta.textContent = `${stats.chatName} · ${stats.totalMessages} messages`;
  const people = stats.people.filter(p => p.name !== "Me");
  board.innerHTML = people.map((p, i) => `
    <li class="person-row">
      <span class="rank ${medalClass(i)}">${i + 1}</span>
      <div class="person-main">
        <div class="person-name">${escapeHtml(p.name)}</div>
        <div class="person-sub">${p.messagesSent} messages · ❤️ ${p.reactions.loved} · 👍 ${p.reactions.liked} · ‼️ ${p.reactions.emphasized} · ❓ ${p.reactions.questioned} · 👎 ${p.reactions.disliked}</div>
      </div>
      <div class="laugh-count">😂 ${p.laughs}</div>
    </li>
  `).join("");
  leaderboardSection.classList.remove("hidden");
}

async function runAnalysis() {
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="spinner"></span>Thinking…';
  try {
    const data = await fetchJSON("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: currentChat }),
    });
    clearError();
    renderAnalysis(data.analysis);
  } catch (err) {
    showError(err.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "🤖 Ask AI who's the funniest";
  }
}

function renderAnalysis(a) {
  if (a.raw) {
    funniestCard.innerHTML = `<p class="blurb">${escapeHtml(a.raw)}</p>`;
    superlativesEl.innerHTML = "";
    closingLineEl.textContent = "";
    analysis.classList.remove("hidden");
    return;
  }
  funniestCard.innerHTML = `
    <div class="crown">👑</div>
    <div class="name">${escapeHtml(a.funniest.name)}</div>
    <p class="blurb">${escapeHtml(a.funniest.blurb)}</p>
  `;
  superlativesEl.innerHTML = (a.superlatives || []).map(s => `
    <div class="superlative-card">
      <div class="title">${escapeHtml(s.title)}</div>
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="blurb">${escapeHtml(s.blurb)}</div>
    </div>
  `).join("");
  closingLineEl.textContent = a.closing_line || "";
  analysis.classList.remove("hidden");
}

chatSelect.addEventListener("change", () => {
  currentChat = chatSelect.value;
  if (currentChat) {
    loadStats(currentChat);
  } else {
    leaderboardSection.classList.add("hidden");
    analyzeSection.classList.add("hidden");
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    await fetchJSON("/api/refresh", { method: "POST" });
    await loadChats();
    if (currentChat) await loadStats(currentChat);
  } catch (err) {
    showError(err.message);
  } finally {
    refreshBtn.disabled = false;
  }
});

analyzeBtn.addEventListener("click", runAnalysis);

loadChats();

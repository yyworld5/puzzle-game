"use strict";

class JellyRanking {
  static apiUrl = "https://waiwai-ranking-api.pwraltezza.workers.dev";

  constructor(find, storage, fetcher = (...args) => fetch(...args)) {
    this.find = find; this.storage = storage; this.fetcher = fetcher;
    this.run = null; this.loadId = 0;
    this.name = find("username"); this.list = find("ranking-list");
    this.name.value = storage.get("jelly-name", "");
    this.name.addEventListener("input", () => {
      find("username-error").hidden = true;
      this.name.setAttribute("aria-invalid", "false");
    });
    find("ranking-refresh").addEventListener("click", () => this.load());
    this.load();
  }

  begin() {
    const username = this.name.value.trim().normalize("NFC");
    if (!username || [...username].length > 12 || /[\u0000-\u001f\u007f]/.test(username)) {
      const error = this.find("username-error");
      error.textContent = "名前を1〜12文字で入力してね。"; error.hidden = false;
      this.name.setAttribute("aria-invalid", "true"); this.name.focus();
      return false;
    }
    this.name.value = username; this.storage.set("jelly-name", username);
    this.name.setAttribute("aria-invalid", "false"); this.find("username-error").hidden = true;
    this.run = {username, submitted: false};
    this.find("score-submission").hidden = true;
    this.find("score-submission").textContent = "";
    return true;
  }

  show(mode) {
    this.find("username-section").hidden = mode === "paused";
    this.find("score-submission").hidden = mode !== "over";
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetcher(JellyRanking.apiUrl + path, {...options, signal: controller.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "connection");
      return data;
    } finally { clearTimeout(timer); }
  }

  async finish(score) {
    const run = this.run;
    if (!run || run.submitted) return;
    run.submitted = true;
    const status = this.find("score-submission");
    status.hidden = false; status.textContent = "ランキングに保存中…";
    try {
      const data = await this.request("/api/scores", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: run.username, score}),
      });
      if (!data.saved) throw new Error("not saved");
      if (this.run === run) status.textContent = "ランキングに保存したよ！";
      await this.load();
    } catch {
      if (this.run === run) status.textContent = "スコアを保存できませんでした。通信状況を確認してね。";
    }
  }

  async load() {
    const loadId = ++this.loadId;
    const status = this.find("ranking-status"), refresh = this.find("ranking-refresh");
    refresh.disabled = true; status.textContent = "ランキングを読み込み中…";
    try {
      const data = await this.request("/api/ranking");
      if (!Array.isArray(data.ranking)) throw new Error("invalid ranking");
      if (loadId !== this.loadId) return;
      // Also suppress duplicate names while an older Worker is being updated.
      const best = new Map();
      for (const record of data.ranking) {
        if (typeof record.username !== "string" || !Number.isSafeInteger(record.score) || record.score < 0) {
          throw new Error("invalid score");
        }
        const name = record.username.trim().normalize("NFC");
        if (!best.has(name) || record.score > best.get(name).score) best.set(name, {...record, username: name});
      }
      const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10).map((record, index) => {
        const row = this.list.ownerDocument.createElement("li");
        for (const [className, text] of [
          ["ranking-place", String(index + 1)], ["ranking-name", record.username],
          ["ranking-score", record.score.toLocaleString()],
        ]) {
          const cell = this.list.ownerDocument.createElement("span");
          cell.className = className; cell.textContent = text; row.appendChild(cell);
        }
        row.title = `${record.username} · ${record.score.toLocaleString()}点`;
        return row;
      });
      this.list.replaceChildren(...rows);
      status.textContent = rows.length ? "同じ名前の最高スコアを掲載。上位10件を表示。" : "まだ記録がありません。一番乗りを目指そう！";
    } catch {
      if (loadId === this.loadId) status.textContent = "読み込めませんでした。「更新」で再度お試しください。";
    } finally {
      if (loadId === this.loadId) refresh.disabled = false;
    }
  }
}

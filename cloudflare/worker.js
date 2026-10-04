const MAX_BODY_BYTES = 1024;

async function readSubmission(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin",
    };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
    if (origin !== "*" && request.headers.get("Origin") && request.headers.get("Origin") !== origin) {
      return reply({error: "このサイトからは利用できません。"}, 403);
    }
    const path = new URL(request.url).pathname;
    if (path !== "/api/ranking" && path !== "/api/scores") return reply({error: "Not found"}, 404);
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers});
    if (!(path === "/api/ranking" && request.method === "GET") &&
        !(path === "/api/scores" && request.method === "POST")) {
      return reply({error: "Method not allowed"}, 405);
    }
    if (!env.DB) return reply({error: "ランキングの保存先が接続されていません。"}, 503);
    try {
      if (path === "/api/ranking") {
        const {results} = await env.DB.prepare(
          `WITH personal_best AS (
            SELECT id, username, score, created_at,
              ROW_NUMBER() OVER (PARTITION BY username ORDER BY score DESC, created_at ASC, id ASC) AS position
            FROM scores
          )
          SELECT id, username, score, created_at FROM personal_best WHERE position = 1
          ORDER BY score DESC, created_at ASC, id ASC LIMIT 10`
        ).all();
        return reply({ranking: results.map((row, index) => ({rank: index + 1, ...row}))});
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
        return reply({error: "JSON形式で送信してください。"}, 415);
      }
      let data;
      try { data = await readSubmission(request); }
      catch (error) { return reply({error: "送信データを確認してください。"}, error.message === "too-large" ? 413 : 400); }
      const username = typeof data?.username === "string" ? data.username.trim().normalize("NFC") : "";
      if (!username || [...username].length > 12 || /[\u0000-\u001f\u007f]/.test(username)) {
        return reply({error: "名前は1〜12文字で入力してください。"}, 400);
      }
      if (!Number.isSafeInteger(data.score) || data.score < 0 || data.score > 2147483647) {
        return reply({error: "スコアが正しくありません。"}, 400);
      }
      const result = await env.DB.prepare("INSERT INTO scores (username, score) VALUES (?, ?)")
        .bind(username, data.score).run();
      return reply({saved: true, id: result.meta.last_row_id}, 201);
    } catch {
      return reply({error: "ランキングに接続できません。時間をおいて再度お試しください。"}, 503);
    }
  },
};

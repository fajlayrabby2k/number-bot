import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest } from "../functions/api/telegram.js";

const secret = "test_webhook_secret";
const message = (text) => ({ message: { chat: { id: 123, type: "private" }, text } });

function webhook(update, { token = secret, body = JSON.stringify(update), env = {} } = {}) {
  return onRequest({
    request: new Request("https://example.test/api/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": token },
      body,
    }),
    env: { TELEGRAM_WEBHOOK_SECRET: secret, ...env },
  });
}

test("rejects unauthorized and malformed requests", async () => {
  assert.equal((await webhook(message("/ping"), { token: "wrong" })).status, 403);
  assert.equal((await webhook(null, { body: "{" })).status, 400);
});

test("answers /ping and /help without D1", async () => {
  const response = await webhook(message("/ping"));
  assert.deepEqual(await response.json(), { method: "sendMessage", chat_id: 123, text: "Pong!" });
  assert.equal((await webhook(message("/help"))).status, 200);
  assert.equal((await webhook(message("hello"))).status, 204);
  assert.equal((await webhook({ message: { chat: { type: "group", id: -123 }, text: "/ping" } })).status, 204);
});

test("records /start once across Telegram retries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync(new URL("../migrations/0001_create_chats.sql", import.meta.url), "utf8"));
    const DB = {
      prepare(sql) {
        return { bind: (id) => ({ run: async () => sqlite.prepare(sql).run(id) }) };
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await webhook(message("/start payload"), { env: { DB } });
      assert.equal(response.status, 200);
      const reply = await response.json();
      assert.match(reply.text, /WELCOME TO NUMBER BOT/);
      assert.deepEqual(reply.reply_markup.keyboard.map((row) => row.map(({ text }) => text.slice(text.indexOf(" ") + 1))), [
        ["Get Number", "Live Traffic"],
        ["Wallet", "Leaderboard"],
        ["Support", "Backup Bot"],
      ]);
      assert.equal(reply.reply_markup.is_persistent, true);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM chats").get().count, 1);
    assert.equal((await webhook(message("/start"))).status, 503);
  } finally {
    sqlite.close();
  }
});

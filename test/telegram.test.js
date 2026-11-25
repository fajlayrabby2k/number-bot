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
      assert.equal(reply.reply_markup.is_persistent, undefined);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM chats").get().count, 1);
    assert.equal((await webhook(message("/start"))).status, 503);
  } finally {
    sqlite.close();
  }
});

test("shows the admin button and opens the panel only for the configured sender", async () => {
  const env = {
    TELEGRAM_ADMIN_ID: "123",
    DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
  };
  const from = (text, id) => ({ message: { ...message(text).message, from: { id } } });
  const start = await (await webhook(from("/start", 123), { env })).json();
  assert.deepEqual(start.reply_markup.keyboard.at(-1), [{ text: "⚙️ Admin Panel" }]);
  assert.equal((await (await webhook(from("⚙️ Admin Panel", 123), { env })).json()).text, "⚙️ Admin Panel");
  assert.equal((await (await webhook(from("/admin", 456), { env })).json()).text, "এই প্যানেলটি শুধু অ্যাডমিনের জন্য।");
  const regular = await (await webhook(from("/start", 123), { env: { DB: env.DB } })).json();
  assert.equal(regular.reply_markup.keyboard.length, 3);
});

test("Fojlay Apps lists 100 synthetic identifiers and restricts stock changes", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const migration = readFileSync(new URL("../migrations/0002_test_stock.sql", import.meta.url), "utf8");
    sqlite.exec(migration);
    sqlite.exec(migration);
    const DB = {
      prepare(sql) {
        return {
          all: async () => ({ results: sqlite.prepare(sql).all() }),
          bind: (...args) => ({ first: async () => sqlite.prepare(sql).get(...args) }),
        };
      },
    };
    const env = { DB, TELEGRAM_ADMIN_ID: "123" };
    const send = async (text, admin = false) => {
      const update = message(text);
      if (admin) update.message.from = { id: 123 };
      return (await webhook(update, { env })).json();
    };
    assert.equal(sqlite.prepare("SELECT SUM(quantity) AS total FROM test_stock").get().total, 100);
    const press = async (data) => (await webhook({
      callback_query: { id: "cb", data, from: { id: 123 }, message: { ...message("").message, message_id: 1 } },
    }, { env })).json();
    const menu = await send("📞 Get Number");
    assert.equal(menu.reply_markup.keyboard, undefined);
    const service = menu.reply_markup.inline_keyboard[0][0];
    assert.equal(service.text, "Fojlay Apps");
    const countries = await press(service.callback_data);
    assert.equal(countries.method, "editMessageText");
    const country = countries.reply_markup.inline_keyboard[0][0];
    const stock = await press(country.callback_data);
    assert.equal(stock.reply_markup.inline_keyboard[0][0].copy_text.text, "TEST-BD-0001");
    const change = stock.reply_markup.inline_keyboard.at(-1)[0];
    assert.equal((await press(change.callback_data)).reply_markup.inline_keyboard[0][0].copy_text.text, "TEST-BD-0006");
    assert.equal((await press("stock:IT:10")).reply_markup.inline_keyboard.at(-2)[0].copy_text.text, "TEST-IT-0050");
    assert.equal((await press("/test_set BD 12")).method, "answerCallbackQuery");
    assert.match((await send("/test_set BD 52")).text, /অ্যাডমিন/);
    assert.match((await send("/test_set BD 52", true)).text, /52/);
  } finally {
    sqlite.close();
  }
});

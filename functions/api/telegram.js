import { claimTestStock, findTestService, stockCallbackInput, testStock } from "../../lib/stock.js";

const encoder = new TextEncoder();
const adminButton = "⚙️ Admin Panel";
const mainMenu = {
  keyboard: [
    [{ text: "📞 Get Number" }, { text: "📊 Live Traffic" }],
    [{ text: "👛 Wallet" }, { text: "🏆 Leaderboard" }],
    [{ text: "🙋 Support" }, { text: "🔄 Backup Bot" }],
  ],
  resize_keyboard: true,
};

function secretMatches(received, expected) {
  if (!received || !expected) return false;
  const left = encoder.encode(received);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secretMatches(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response(null, { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const callback = update?.callback_query;
  if (callback) {
    const message = callback.message;
    const chatId = message?.chat?.id;
    const input = stockCallbackInput(callback.data);
    if (message?.chat?.type !== "private" || !Number.isSafeInteger(chatId) ||
        callback.from?.id !== chatId || !Number.isSafeInteger(message.message_id) ||
        typeof callback.id !== "string") {
      return new Response(null, { status: 204 });
    }
    const acknowledge = { method: "answerCallbackQuery", callback_query_id: callback.id };
    const claim = /^stock:claim:(?:([a-z][a-z0-9-]{0,23}):)?([A-Z]{2})$/.exec(callback.data);
    const serviceId = claim?.[1] ?? "fojlay";
    if (!input && !claim) return Response.json(acknowledge);
    try {
      const selected = claim ? await findTestService(env.DB, serviceId) : undefined;
      if (claim && !selected) return Response.json({ ...acknowledge, text: "সার্ভিসটি পাওয়া যাচ্ছে না।" });
      const result = claim
        ? await claimTestStock(env.DB, claim[2], chatId, callback.id, serviceId, selected.name)
        : await testStock(input, env.DB, String(chatId) === env.TELEGRAM_ADMIN_ID?.trim());
      if (!result) return Response.json(acknowledge);
      if (!result?.replyMarkup) return Response.json({ ...acknowledge, text: result?.text });
      return Response.json({
        method: "editMessageText",
        chat_id: chatId,
        message_id: message.message_id,
        text: result.text,
        entities: result.entities,
        reply_markup: result.replyMarkup,
      });
    } catch {
      console.error("D1 could not load test stock");
      return Response.json({ ...acknowledge, text: "স্টক লোড হয়নি। আবার চেষ্টা করুন।" });
    }
  }

  const message = update?.message;
  if (message?.chat?.type !== "private" ||
      !Number.isSafeInteger(message.chat.id) ||
      typeof message.text !== "string") {
    return new Response(null, { status: 204 });
  }

  const input = message.text.trim();
  const command = input === adminButton ? "/admin" : input.split(/\s+/, 1)[0];
  const senderId = message.from?.id;
  const isAdmin = Number.isSafeInteger(senderId) &&
    senderId === message.chat.id &&
    String(senderId) === env.TELEGRAM_ADMIN_ID?.trim();
  let text;
  let replyMarkup;
  let entities;
  switch (command) {
    case "/start":
      if (!env.DB) return new Response(null, { status: 503 });
      try {
        await env.DB.prepare(
          "INSERT INTO chats (chat_id) VALUES (?) ON CONFLICT(chat_id) DO NOTHING"
        ).bind(message.chat.id).run();
      } catch {
        console.error("D1 could not record /start");
        return new Response(null, { status: 503 });
      }
      text = "👋 HELLO & WELCOME TO NUMBER BOT\n📞 Fojlay Apps Demo Numbers\n⚡ Choose Get Number to browse";
      replyMarkup = isAdmin
        ? { ...mainMenu, keyboard: [...mainMenu.keyboard, [{ text: adminButton }]] }
        : mainMenu;
      break;
    case "/id":
      text = `আপনার Telegram ID: ${message.chat.id}`;
      break;
    case "/admin":
      text = isAdmin ? "⚙️ Admin Panel" : "এই প্যানেলটি শুধু অ্যাডমিনের জন্য।";
      if (isAdmin) replyMarkup = { keyboard: [[{ text: "/services" }, { text: "📦 Number Stock" }], [{ text: "/service_add" }, { text: "/service_delete" }], [{ text: "/start" }]], resize_keyboard: true };
      break;
    case "/help":
      text = "/start — বট শুরু করুন\n/help — কমান্ড দেখুন\n/ping — বট সক্রিয় কি না দেখুন";
      break;
    case "/ping":
      text = "Pong!";
      break;
    default: {
      try {
        const result = await testStock(input, env.DB, isAdmin);
        if (!result) return new Response(null, { status: 204 });
        ({ text, replyMarkup, entities } = result);
      } catch {
        console.error("D1 could not load or update test stock");
        return new Response(null, { status: 503 });
      }
      break;
    }
  }

  // Telegram executes this Bot API method directly from the webhook response.
  return Response.json({ method: "sendMessage", chat_id: message.chat.id, text, entities, reply_markup: replyMarkup });
}

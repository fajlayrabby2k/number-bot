const encoder = new TextEncoder();
const mainMenu = {
  keyboard: [
    [{ text: "📞 Get Number" }, { text: "📊 Live Traffic" }],
    [{ text: "👛 Wallet" }, { text: "🏆 Leaderboard" }],
    [{ text: "🙋 Support" }, { text: "🔄 Backup Bot" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
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

  const message = update?.message;
  // In private chats, addressed commands cannot be intended for another bot.
  if (message?.chat?.type !== "private" ||
      !Number.isSafeInteger(message.chat.id) ||
      typeof message.text !== "string") {
    return new Response(null, { status: 204 });
  }

  const command = message.text.trim().split(/\s+/, 1)[0];
  let text;
  let replyMarkup;
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
      text = "👋 HELLO & WELCOME TO NUMBER BOT\n📞 GET FREE VIRTUAL NUMBERS\n⚡ FAST & SIMPLE SMS SERVICE";
      replyMarkup = mainMenu;
      break;
    case "/help":
      text = "/start — বট শুরু করুন\n/help — কমান্ড দেখুন\n/ping — বট সক্রিয় কি না দেখুন";
      break;
    case "/ping":
      text = "Pong!";
      break;
    default:
      return new Response(null, { status: 204 });
  }

  // Telegram executes this Bot API method directly from the webhook response.
  return Response.json({ method: "sendMessage", chat_id: message.chat.id, text, reply_markup: replyMarkup });
}

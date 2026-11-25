const defaultService = "fojlay";
const service = "Fojlay Apps";
export function testServices(config) {
  const services = new Map([[defaultService, service]]);
  if (!config) return services;
  try {
    const entries = JSON.parse(config);
    if (!entries || Array.isArray(entries) || typeof entries !== "object") return services;
    for (const [id, value] of Object.entries(entries)) {
      if (/^[a-z][a-z0-9-]{0,23}$/.test(id) && id !== defaultService &&
          typeof value === "string" && value.trim() && value.trim().length <= 48) {
        services.set(id, value.trim());
      }
      if (services.size === 20) break;
    }
  } catch {
    console.error("Invalid TEST_SERVICES configuration");
  }
  return services;
}
const cardClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Dhaka",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});
const countryNames = new Intl.DisplayNames(["bn"], { type: "region", fallback: "code" });
const countryLabel = (country) => `${countryNames.of(country)} (${country})`;
const button = (text, action) => ({ text, callback_data: `stock:${action}` });
const inline = (rows) => ({ inline_keyboard: rows });

export async function claimTestStock(db, country, chatId, callbackId, serviceId, serviceName) {
  // The cursor and insert run in one SQLite write statement.
  const { results } = await db.prepare(`
    WITH cursor AS MATERIALIZED (
      SELECT quantity, COALESCE((
        SELECT MAX(serial) FROM test_stock_claims WHERE country = ?1
      ), 0) AS last
      FROM test_stock
      WHERE country = ?1
        AND NOT EXISTS (SELECT 1 FROM test_stock_claims WHERE callback_id = ?3)
    ), steps(n) AS (VALUES (1), (2), (3))
    INSERT INTO test_stock_claims (country, serial, chat_id, callback_id)
    SELECT ?1, last + n, ?2, ?3 FROM cursor CROSS JOIN steps
    WHERE last + n <= quantity
    RETURNING serial, (SELECT quantity FROM test_stock WHERE country = ?1) AS quantity
  `).bind(country, chatId, callbackId).all();

  if (!results.length) {
    const replay = await db.prepare(
      "SELECT 1 AS claimed FROM test_stock_claims WHERE callback_id = ?"
    ).bind(callbackId).first();
    if (replay) return;
    return { text: `${serviceName} · ${countryLabel(country)}\nটেস্ট স্টক শেষ।`, replyMarkup: inline([[button("🌍 Country", `countries:${serviceId}`)]]) };
  }

  results.sort((left, right) => left.serial - right.serial);
  const rows = results.map(({ serial }) => {
    const number = `TEST-BATCH-${country}-${String(serial).padStart(4, "0")}`;
    return [{ text: `☎️ ${number}`, style: "success", copy_text: { text: number } }];
  });
  const last = results.at(-1);
  const navigation = [button("🌍 Country", `countries:${serviceId}`)];
  if (last.serial < last.quantity) navigation.unshift(button("🔄 Change", `claim:${serviceId}:${country}`));
  rows.push(navigation.map((item) => ({ ...item, style: "primary" })));
  const flag = String.fromCodePoint(...Array.from(country, (letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  const text = [
    "╭──────── ✦ ────────╮",
    `${flag} ${countryLabel(country)} · Test Numbers`,
    `📱 ${serviceName}`,
    `⏱ Refreshed: ${cardClock.format(new Date())}`,
    "╰──────── ✦ ────────╯",
  ].join("\n");
  return {
    text,
    entities: [{ type: "blockquote", offset: 0, length: text.length }],
    replyMarkup: inline(rows),
  };
}

export async function testStock(input, db, isAdmin, services) {
  if (input === "📞 Get Number") {
    const text = "📞 Select a Service";
    return {
      text,
      entities: [{ type: "blockquote", offset: 0, length: text.length }],
      replyMarkup: inline([...services].map(([id, name]) => [
        { ...button(name, `countries:${id}`), style: "primary" },
      ])),
    };
  }

  if (input === "/test_stock") {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const { results } = await db.prepare(`
      SELECT country, quantity, MAX(0, quantity - COALESCE((
        SELECT MAX(serial) FROM test_stock_claims WHERE country = test_stock.country
      ), 0)) AS remaining FROM test_stock ORDER BY country
    `).all();
    const stock = results.map(({ country, quantity, remaining }) => `${countryLabel(country)}: বাকি ${remaining} / মোট ${quantity}`).join("\n");
    return { text: `Fojlay Apps টেস্ট স্টক\n${stock || "স্টক খালি"}\n\nদেশের মোট স্টক সেট করতে /test_set BD 60 লিখুন।` };
  }

  if (input === "/test_set" || input.startsWith("/test_set ")) {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const match = /^\/test_set ([A-Za-z]{2}) ([1-9]\d{0,4})$/.exec(input);
    if (!match || Number(match[2]) > 10000) return { text: "দেশের দুই অক্ষরের কোড ও ১–১০,০০০ মোট পরিমাণ দিন। যেমন /test_set BD 60" };
    const country = match[1].toUpperCase();
    if (countryNames.of(country) === country) return { text: "দেশের বৈধ দুই অক্ষরের কোড দিন।" };
    const saved = await db.prepare(
      "INSERT INTO test_stock (country, quantity) VALUES (?, ?) ON CONFLICT(country) DO UPDATE SET quantity = excluded.quantity RETURNING quantity"
    ).bind(country, Number(match[2])).first();
    return { text: `${countryLabel(country)} টেস্ট স্টক: ${saved.quantity}` };
  }

  const serviceId = input === service ? defaultService : /^stock:countries:([a-z][a-z0-9-]{0,23})$/.exec(input)?.[1];
  if (services.has(serviceId)) {
    const { results } = await db.prepare("SELECT country FROM test_stock ORDER BY country").all();
    const buttons = results.map(({ country }) => button(countryLabel(country), `claim:${serviceId}:${country}`));
    const rows = [];
    for (let index = 0; index < buttons.length; index += 2) {
      rows.push(buttons.slice(index, index + 2));
    }
    rows.push([button("⬅️ Back", "services")]);
    return { text: `${services.get(serviceId)} · দেশ বেছে নিন।`, replyMarkup: inline(rows) };
  }

}

export function stockCallbackInput(data) {
  if (data === "stock:services") return "📞 Get Number";
  if (data === "stock:countries") return service;
  if (typeof data === "string" && data.startsWith("stock:countries:")) return data;
}

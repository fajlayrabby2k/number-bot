const service = "Fojlay Apps";
const countryNames = new Intl.DisplayNames(["bn"], { type: "region", fallback: "code" });
const countryLabel = (country) => `${countryNames.of(country)} (${country})`;
const button = (text, action) => ({ text, callback_data: `stock:${action}` });
const inline = (rows) => ({ inline_keyboard: rows });

export async function claimTestStock(db, country, chatId, callbackId) {
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
    return { text: `Fojlay Apps · ${countryLabel(country)}\nটেস্ট স্টক শেষ।`, replyMarkup: inline([[button("🌍 Country", "countries")]]) };
  }

  results.sort((left, right) => left.serial - right.serial);
  const rows = results.map(({ serial }) => {
    const number = `TEST-BATCH-${country}-${String(serial).padStart(4, "0")}`;
    return [{ text: number, copy_text: { text: number } }];
  });
  const last = results.at(-1);
  const navigation = [button("🌍 Country", "countries")];
  if (last.serial < last.quantity) navigation.unshift(button("🔄 Change", `claim:${country}`));
  rows.push(navigation);
  return {
    text: `Fojlay Apps · ${countryLabel(country)}\nটেস্ট বরাদ্দ: ${results.length} · বাকি: ${last.quantity - last.serial}\nকপি করতে নম্বরে চাপুন।`,
    replyMarkup: inline(rows),
  };
}

export async function testStock(input, db, isAdmin) {
  if (input === "📞 Get Number") {
    return { text: "সার্ভিস বেছে নিন", replyMarkup: inline([[button(service, "countries")]]) };
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

  if (input === service) {
    const { results } = await db.prepare("SELECT country FROM test_stock ORDER BY country").all();
    const buttons = results.map(({ country }) => button(countryLabel(country), `claim:${country}`));
    const rows = [];
    for (let index = 0; index < buttons.length; index += 2) {
      rows.push(buttons.slice(index, index + 2));
    }
    rows.push([button("⬅️ Back", "services")]);
    return { text: "Fojlay Apps-এর জন্য দেশ বেছে নিন।", replyMarkup: inline(rows) };
  }

}

export function stockCallbackInput(data) {
  if (data === "stock:services") return "📞 Get Number";
  if (data === "stock:countries") return service;
}

const defaultService = "fojlay";
const service = "Fojlay Apps";
export function findTestService(db, id) {
  return db.prepare("SELECT name FROM test_services WHERE id = ? AND active = 1").bind(id).first();
}

async function listTestServices(db) {
  const { results } = await db.prepare(
    "SELECT id, name FROM test_services WHERE active = 1 ORDER BY id <> 'fojlay', name, id"
  ).all();
  return results;
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
const addAmounts = [10, 100, 500, 1000];

function pairs(buttons) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return rows;
}

// Keep the original Fojlay pool in place so historical IDs and allocations stay intact.
function pool(serviceId) {
  return serviceId === defaultService
    ? { stock: "test_stock", claims: "test_stock_claims", column: "country", prefix: "" }
    : { stock: "service_test_stock", claims: "service_test_stock_claims", column: "stock_key", prefix: `${serviceId}:` };
}

async function countryStock(db, serviceId) {
  const { stock, claims, column, prefix } = pool(serviceId);
  const { results } = await db.prepare(`
    SELECT SUBSTR(s.${column}, LENGTH(?1) + 1) AS country, s.quantity,
      MAX(0, s.quantity - COALESCE((
        SELECT MAX(serial) FROM ${claims} WHERE ${column} = s.${column}
      ), 0)) AS remaining
    FROM ${stock} AS s WHERE s.${column} GLOB (?1 || '[A-Z][A-Z]') ORDER BY country
  `).bind(prefix).all();
  return results;
}

export async function claimTestStock(db, country, chatId, callbackId, serviceId, serviceName) {
  const { stock, claims, column, prefix } = pool(serviceId);
  // The cursor and insert run in one SQLite write statement.
  const { results } = await db.prepare(`
    WITH cursor AS MATERIALIZED (
      SELECT quantity, COALESCE((
        SELECT MAX(serial) FROM ${claims} WHERE ${column} = ?1
      ), 0) AS last
      FROM ${stock}
      WHERE ${column} = ?1
        AND EXISTS (SELECT 1 FROM test_services WHERE id = ?4 AND active = 1)
        AND NOT EXISTS (SELECT 1 FROM ${claims} WHERE callback_id = ?3)
    ), steps(n) AS (VALUES (1), (2), (3))
    INSERT INTO ${claims} (${column}, serial, chat_id, callback_id)
    SELECT ?1, last + n, ?2, ?3 FROM cursor CROSS JOIN steps
    WHERE last + n <= quantity
    RETURNING serial, (SELECT quantity FROM ${stock} WHERE ${column} = ?1) AS quantity
  `).bind(prefix + country, chatId, callbackId, serviceId).all();

  if (!results.length) {
    const replay = await db.prepare(
      `SELECT 1 AS claimed FROM ${claims} WHERE callback_id = ?`
    ).bind(callbackId).first();
    if (replay) return;
    return { text: `${serviceName} · ${countryLabel(country)}\nডেমো স্টক শেষ।`, replyMarkup: inline([[button("🌍 Country", `countries:${serviceId}`)]]) };
  }

  results.sort((left, right) => left.serial - right.serial);
  const rows = results.map(({ serial }) => {
    const number = `DEMO-${prefix ? serviceId.toUpperCase() + "-" : ""}${country}-${String(serial).padStart(4, "0")}`;
    return [{ text: `☎️ ${number}`, style: "success", copy_text: { text: number } }];
  });
  const last = results.at(-1);
  const navigation = [button("🌍 Country", `countries:${serviceId}`)];
  if (last.serial < last.quantity) navigation.unshift(button("🔄 Change", `claim:${serviceId}:${country}`));
  rows.push(navigation.map((item) => ({ ...item, style: "primary" })));
  const flag = String.fromCodePoint(...Array.from(country, (letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  const text = [
    "╭──────── ✦ ────────╮",
    `${flag} ${countryLabel(country)} · Demo Numbers`,
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

export async function testStock(input, db, isAdmin) {
  if (input === "📞 Get Number") {
    const services = await listTestServices(db);
    if (!services.length) return { text: "এখন কোনো ডেমো সার্ভিস চালু নেই।" };
    const text = "📞 Select a Service";
    return {
      text,
      entities: [{ type: "blockquote", offset: 0, length: text.length }],
      replyMarkup: inline(services.map(({ id, name }) => [
        { ...button(name, `countries:${id}`), style: "primary" },
      ])),
    };
  }

  const adminServiceCommand = input.split(/\s+/, 1)[0];
  if (["/services", "/service_add", "/service_delete"].includes(adminServiceCommand)) {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    if (adminServiceCommand === "/service_add") {
      const match = /^\/service_add ([a-z][a-z0-9-]{0,23}) ([^\r\n]{1,48})$/.exec(input);
      if (!match || !match[2].trim()) return { text: "যোগ করতে লিখুন /service_add demo Fojlay Demo" };
      const saved = await db.prepare(`
        INSERT INTO test_services (id, name)
        SELECT ?, ? WHERE (SELECT COUNT(*) FROM test_services WHERE active = 1) < 20
          OR EXISTS (SELECT 1 FROM test_services WHERE id = ? AND active = 1)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1
        RETURNING name
      `).bind(match[1], match[2].trim(), match[1]).first();
      return { text: saved ? `চালু হয়েছে: ${saved.name}` : "সর্বোচ্চ ২০টি সার্ভিস চালু রাখা যায়।" };
    }
    if (adminServiceCommand === "/service_delete") {
      const match = /^\/service_delete ([a-z][a-z0-9-]{0,23})$/.exec(input);
      if (!match) return { text: "সরাতে লিখুন /service_delete demo" };
      const removed = await db.prepare(
        "UPDATE test_services SET active = 0 WHERE id = ? AND active = 1 RETURNING name"
      ).bind(match[1]).first();
      return { text: removed ? `তালিকা থেকে সরানো হয়েছে: ${removed.name}` : "সার্ভিসটি চালু নেই।" };
    }
    const services = await listTestServices(db);
    const list = services.map(({ id, name }) => `${name} (${id})`).join("\n");
    return { text: `ডেমো সার্ভিস\n${list || "তালিকা খালি"}\n\nযোগ: /service_add demo Fojlay Demo\nসরাতে: /service_delete demo` };
  }

  if (input === "/test_stock" || input === "📦 Number Stock") {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const services = await listTestServices(db);
    if (!services.length) return { text: "এখন কোনো ডেমো সার্ভিস চালু নেই।" };
    return {
      text: "স্টক পরিচালনার জন্য সার্ভিস বেছে নিন।",
      replyMarkup: inline(services.map(({ id, name }) => [button(name, `manage:${id}`)])),
    };
  }

  const manage = /^stock:manage:([a-z][a-z0-9-]{0,23})(?::([A-Z]{2})(?::(0|[1-9]\d{0,4}):(10|100|500|1000))?)?$/.exec(input);
  if (manage) {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const [, id, country, expected, amount] = manage;
    const selected = await findTestService(db, id);
    if (!selected) return { text: "সার্ভিসটি পাওয়া যাচ্ছে না।", replyMarkup: inline([[button("⬅️ Back", "manage")]]) };

    if (!country) {
      const { results } = await db.prepare(`
        SELECT 'BD' AS country UNION SELECT 'IT'
        UNION SELECT country FROM test_stock
        UNION SELECT SUBSTR(stock_key, -2) FROM service_test_stock
        ORDER BY country
      `).all();
      const rows = pairs(results.map(({ country }) => button(countryLabel(country), `manage:${id}:${country}`)));
      rows.push([button("⬅️ Back", "manage")]);
      return { text: `${selected.name} · দেশ বেছে নিন।`, replyMarkup: inline(rows) };
    }

    let status = "";
    if (amount) {
      const { stock, claims, column, prefix } = pool(id);
      const key = prefix + country;
      // Compare against the displayed quantity so a repeated tap cannot add the same batch twice.
      const saved = await db.prepare(`
        WITH current AS MATERIALIZED (
          SELECT COALESCE((SELECT quantity FROM ${stock} WHERE ${column} = ?1), 0) AS quantity,
            COALESCE((SELECT MAX(serial) FROM ${claims} WHERE ${column} = ?1), 0) AS issued
        )
        INSERT INTO ${stock} (${column}, quantity)
        SELECT ?1, MAX(quantity, issued) + ?2 FROM current
        WHERE quantity = ?3 AND MAX(quantity, issued) + ?2 <= 10000
          AND EXISTS (SELECT 1 FROM test_services WHERE id = ?4 AND active = 1)
        ON CONFLICT(${column}) DO UPDATE SET quantity = excluded.quantity RETURNING quantity
      `).bind(key, Number(amount), Number(expected), id).first();
      status = saved ? `\n✅ ${amount}টি ডেমো নম্বর যোগ হয়েছে।` : "\nস্টক বদলেছে বা সীমা পূর্ণ হয়েছে। বর্তমান স্টক দেখুন।";
    }

    const stock = (await countryStock(db, id)).find((entry) => entry.country === country);
    const quantity = stock?.quantity ?? 0;
    const additions = addAmounts.filter((value) => quantity + value <= 10000).map((value) => ({
      ...button(`+ ${value}`, `manage:${id}:${country}:${quantity}:${value}`),
      style: "success",
    }));
    const rows = pairs(additions);
    rows.push([button("⬅️ Back", `manage:${id}`)]);
    return {
      text: `${selected.name} · ${countryLabel(country)}\nমোট: ${quantity} · বাকি: ${stock?.remaining ?? 0}${status}\n${additions.length ? "কতটি যোগ করবেন বেছে নিন।" : "স্টকের সীমা পূর্ণ হয়েছে।"}`,
      replyMarkup: inline(rows),
    };
  }

  if (adminServiceCommand === "/test_set") {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const match = /^\/test_set ([a-z][a-z0-9-]{0,23}) ([A-Za-z]{2}) ([1-9]\d{0,4})$/.exec(input);
    if (!match || Number(match[3]) > 10000) return { text: "সার্ভিস ID, দেশের কোড ও মোট পরিমাণ দিন। যেমন /test_set fojlay BD 60" };
    const [, id, code, quantity] = match;
    const country = code.toUpperCase();
    if (countryNames.of(country) === country) return { text: "দেশের বৈধ দুই অক্ষরের কোড দিন।" };
    const { stock, column, prefix } = pool(id);
    const saved = await db.prepare(`
      INSERT INTO ${stock} (${column}, quantity)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM test_services WHERE id = ? AND active = 1)
      ON CONFLICT(${column}) DO UPDATE SET quantity = excluded.quantity RETURNING quantity
    `).bind(prefix + country, Number(quantity), id).first();
    return { text: saved ? `${id} · ${countryLabel(country)} ডেমো স্টক: ${saved.quantity}` : "সার্ভিসটি পাওয়া যাচ্ছে না।" };
  }

  const serviceId = input === service ? defaultService : /^stock:countries:([a-z][a-z0-9-]{0,23})$/.exec(input)?.[1];
  if (serviceId) {
    const selected = await findTestService(db, serviceId);
    if (!selected) return { text: "সার্ভিসটি পাওয়া যাচ্ছে না।", replyMarkup: inline([[button("⬅️ Back", "services")]]) };
    const results = (await countryStock(db, serviceId)).filter(({ remaining }) => remaining > 0);
    const buttons = results.map(({ country }) => button(countryLabel(country), `claim:${serviceId}:${country}`));
    const rows = pairs(buttons);
    rows.push([button("⬅️ Back", "services")]);
    return { text: `${selected.name} · ${buttons.length ? "দেশ বেছে নিন।" : "এখন ডেমো স্টক নেই।"}`, replyMarkup: inline(rows) };
  }

}

export function stockCallbackInput(data) {
  if (data === "stock:services") return "📞 Get Number";
  if (data === "stock:countries") return service;
  if (data === "stock:manage") return "/test_stock";
  if (typeof data === "string" && data.startsWith("stock:manage:")) return data;
  if (typeof data === "string" && data.startsWith("stock:countries:")) return data;
}

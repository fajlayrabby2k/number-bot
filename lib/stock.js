const service = "Fojlay Apps";
const pageSize = 5;
const countryNames = new Intl.DisplayNames(["bn"], { type: "region", fallback: "code" });
const countryLabel = (country) => `${countryNames.of(country)} (${country})`;
const keyboard = (rows) => ({ keyboard: rows.map((row) => row.map((text) => ({ text }))), resize_keyboard: true });

export async function testStock(input, db, isAdmin) {
  if (input === "📞 Get Number") {
    return { text: "সার্ভিস বেছে নিন", replyMarkup: keyboard([[service], ["/start"]]) };
  }

  if (input === "/test_stock") {
    if (!isAdmin) return { text: "এই অপশনটি শুধু অ্যাডমিনের জন্য।" };
    const { results } = await db.prepare("SELECT country, quantity FROM test_stock ORDER BY country").all();
    const stock = results.map(({ country, quantity }) => `${countryLabel(country)}: ${quantity}`).join("\n");
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
    const rows = results.map(({ country }) => [`🌍 ${countryLabel(country)}`]);
    return { text: "Fojlay Apps-এর জন্য দেশ বেছে নিন।", replyMarkup: keyboard([...rows, ["📞 Get Number", "/start"]]) };
  }

  const countryChoice = /^🌍 .+ \(([A-Z]{2})\)$/.exec(input);
  const pageChoice = /^\/test_([a-z]{2})_([1-9]\d{0,3})$/i.exec(input);
  if (!countryChoice && !pageChoice) return;
  const country = (countryChoice?.[1] ?? pageChoice[1]).toUpperCase();
  const page = Number(pageChoice?.[2] ?? 1);
  const stock = await db.prepare("SELECT quantity FROM test_stock WHERE country = ?").bind(country).first();
  const offset = (page - 1) * pageSize;
  if (!stock || offset >= stock.quantity) return { text: "এই পাতায় কোনো টেস্ট নম্বর নেই।" };
  const count = Math.min(pageSize, stock.quantity - offset);
  const numbers = Array.from({ length: count }, (_, index) =>
    `TEST-${country}-${String(offset + index + 1).padStart(4, "0")}`);
  const next = offset + count < stock.quantity ? `\nপরের পাতা /test_${country.toLowerCase()}_${page + 1}` : "";
  return {
    text: `Fojlay Apps · ${countryLabel(country)}\nটেস্ট নম্বর কপি করতে বাটনে চাপুন।${next}`,
    replyMarkup: { inline_keyboard: numbers.map((number) => [{ text: number, copy_text: { text: number } }]) },
  };
}

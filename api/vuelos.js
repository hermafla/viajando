export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: "Falta TRAVELPAYOUTS_TOKEN en Vercel" });
  }

  const origin = String(req.query.origin || "BUE").toUpperCase();
  const destination = String(req.query.destination || "RIO").toUpperCase();
  const currency = String(req.query.currency || "usd").toLowerCase();

  const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("currency", currency);
  url.searchParams.set("unique", "false");
  url.searchParams.set("sorting", "price");
  url.searchParams.set("direct", "false");
  url.searchParams.set("limit", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("one_way", "false");
  url.searchParams.set("token", token);

  try {
    const response = await fetch(url, {
      headers: { "Accept-Encoding": "gzip, deflate" }
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "Aviasales devolvió un error",
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      source: "Aviasales Data API",
      cached: true,
      origin,
      destination,
      currency: currency.toUpperCase(),
      ...data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "No se pudo consultar Aviasales" });
  }
}

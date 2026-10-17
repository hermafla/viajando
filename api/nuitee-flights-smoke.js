export default async function handler(req, res) {
  // Temporary smoke test, restricted to the protected Vercel Preview deployment.
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.NUITEE_FLIGHTS_SANDBOX_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: "Flights Sandbox key is missing in Preview." });
  }

  const requestBody = {
    legs: [
      { origin: "EZE", destination: "GIG", date: "2026-11-10", direction: "OUTBOUND" },
      { origin: "GIG", destination: "EZE", date: "2026-11-17", direction: "INBOUND" }
    ],
    adults: 1,
    children: 0,
    infants: 0,
    currency: "USD",
    country: "AR"
  };

  res.setHeader("Cache-Control", "no-store");
  try {
    const response = await fetch("https://api.liteapi.travel/v3.0/flights/rates", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(18000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(200).json({
        ok: false,
        providerStatus: response.status,
        providerError: payload?.error?.message || payload?.message || payload?.error || "Nuitee rejected the Sandbox search.",
        request: { origin: "EZE", destination: "GIG", departureDate: "2026-11-10", returnDate: "2026-11-17", adults: 1, currency: "USD", country: "AR" }
      });
    }

    const batches = Array.isArray(payload?.data) ? payload.data : [];
    const journeys = batches.flatMap(batch => Array.isArray(batch?.journeys) ? batch.journeys : []);
    const offers = journeys.flatMap(journey => Array.isArray(journey?.offers) ? journey.offers : []);
    const sample = offers.slice(0, 5).map(offer => ({
      provider: offer.providerName || offer.provider || null,
      offerIdPresent: Boolean(offer.offerId),
      pricing: offer.pricing || null,
      cabinClass: offer.cabinClass || null
    }));

    return res.status(200).json({
      ok: true,
      sandbox: true,
      request: { origin: "EZE", destination: "GIG", departureDate: "2026-11-10", returnDate: "2026-11-17", adults: 1, currency: "USD", country: "AR" },
      batchCount: batches.length,
      journeyCount: journeys.length,
      offerCount: offers.length,
      sample
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error?.name === "TimeoutError" ? "Nuitee Sandbox search timed out." : "Could not connect to Nuitee Sandbox."
    });
  }
}

function collectOfferArray(value, depth = 0) {
  if (depth > 5 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    if (value.length && value.some(item => item && typeof item === 'object')) return value;
    return null;
  }
  for (const key of ['data', 'offers', 'rates', 'results', 'flights', 'itineraries']) {
    const found = collectOfferArray(value[key], depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = collectOfferArray(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function findAmount(offer) {
  const candidates = [
    offer?.price?.amount, offer?.price?.total, offer?.price,
    offer?.total?.amount, offer?.total?.value, offer?.total,
    offer?.grandTotal?.amount, offer?.grandTotal,
    offer?.amount
  ];
  for (const value of candidates) {
    const amount = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const expected = process.env.NUITEE_FLIGHTS_PROD_CHECK_TOKEN;
  if (!expected || req.headers.authorization !== 'Bearer ' + expected) return res.status(404).json({ ok: false });

  const apiKey = process.env.NUITEE_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, stage: 'configuration' });

  const requestBody = {
    legs: [
      { origin: 'BUE', destination: 'FLN', date: '2026-11-20', direction: 'OUTBOUND' },
      { origin: 'FLN', destination: 'BUE', date: '2026-11-27', direction: 'INBOUND' }
    ],
    adults: 2,
    children: 0,
    infants: 0,
    currency: 'USD',
    country: 'AR'
  };

  try {
    const response = await fetch('https://api.liteapi.travel/v3.0/flights/rates', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.json().catch(() => ({}));
    const offers = collectOfferArray(body);
    const amounts = (offers || []).map(findAmount).filter(Number.isFinite).sort((a, b) => a - b);
    if (!response.ok) {
      return res.status(200).json({
        ok: false,
        providerStatus: response.status,
        providerError: String(body?.error?.message || body?.message || body?.error || 'Flights API rechazó la búsqueda.').slice(0, 220),
        responseKeys: Object.keys(body || {}).slice(0, 12)
      });
    }
    return res.status(200).json({
      ok: true,
      providerStatus: response.status,
      itinerary: 'BUE–FLN–BUE, 20–27 nov 2026, 2 adultos',
      currency: 'USD',
      offersFound: offers?.length ?? 0,
      sampleLowestAmounts: amounts.slice(0, 5),
      responseKeys: Object.keys(body || {}).slice(0, 12),
      offerKeys: offers?.[0] && typeof offers[0] === 'object' ? Object.keys(offers[0]).slice(0, 20) : []
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      stage: 'network',
      error: String(error?.name || 'RequestError')
    });
  }
}

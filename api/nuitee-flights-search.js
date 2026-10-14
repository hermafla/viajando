export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  // Esta ruta de prueba nunca puede consultar vuelos desde Producción.
  if (process.env.VERCEL_ENV === "production") {
    return res.status(404).json({ ok: false, error: "Búsqueda de vuelos de prueba no disponible." });
  }

  const apiKey = process.env.NUITEE_FLIGHTS_SANDBOX_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: "Falta configurar NUITEE_FLIGHTS_SANDBOX_API_KEY en Vercel Preview."
    });
  }

  const body = req.body || {};
  const legs = Array.isArray(body.legs) ? body.legs : [];
  const adults = Number(body.adults);
  const children = Number(body.children || 0);
  const infants = Number(body.infants || 0);
  const currency = String(body.currency || "USD").toUpperCase();

  if (!legs.length || legs.length > 6 ||
      legs.some(leg => !/^[A-Z]{3}$/.test(String(leg.origin || "")) ||
                       !/^[A-Z]{3}$/.test(String(leg.destination || "")) ||
                       !/^\d{4}-\d{2}-\d{2}$/.test(String(leg.date || ""))) ||
      !Number.isInteger(adults) || adults < 1 || adults > 9 ||
      !Number.isInteger(children) || children < 0 ||
      !Number.isInteger(infants) || infants < 0 ||
      !/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ ok: false, error: "Revisá aeropuertos, fechas y cantidad de pasajeros." });
  }

  const requestBody = {
    legs: legs.map((leg, index) => ({
      origin: String(leg.origin).toUpperCase(),
      destination: String(leg.destination).toUpperCase(),
      date: String(leg.date),
      direction: index === 0 ? "OUTBOUND" : "INBOUND"
    })),
    adults,
    children,
    infants,
    currency,
    country: "AR"
  };

  if (Array.isArray(body.childrenAges) && body.childrenAges.length === children) {
    requestBody.childrenAges = body.childrenAges.map(Number);
  }
  if (Array.isArray(body.infantAges) && body.infantAges.length === infants) {
    requestBody.infantAges = body.infantAges.map(Number);
  }

  try {
    const response = await fetch("https://api.liteapi.travel/v3.0/flights/rates", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = response.status === 401
        ? "Nuitee no aceptó la clave de Sandbox."
        : response.status === 403 || response.status === 503
          ? "Nuitee todavía no habilitó Flights para esta cuenta."
          : "Nuitee no pudo completar la búsqueda de vuelos.";
      return res.status(response.status >= 500 ? 502 : response.status).json({
        ok: false,
        error: message,
        providerStatus: response.status
      });
    }

    return res.status(200).json({ ok: true, sandbox: true, data });
  } catch (error) {
    console.error("Nuitee Flights sandbox search failed:", error?.message || error);
    return res.status(502).json({ ok: false, error: "No pudimos conectar con Nuitee para buscar vuelos." });
  }
}

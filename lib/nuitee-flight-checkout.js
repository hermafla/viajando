import crypto from 'node:crypto';

const clean = value => String(value ?? '').trim();
const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const json = (res, status, body) => res.status(status).json(body);
const base = () => process.env.SUPABASE_URL?.replace(/\/$/, '');
const dbKey = () => process.env.SUPABASE_SECRET_KEY;
const bookingEnv = () => process.env.VERCEL_ENV === 'production' ? 'production' : 'sandbox';
const apiKey = env => env === 'production' ? process.env.NUITEE_API_KEY : process.env.NUITEE_FLIGHTS_SANDBOX_API_KEY;
const enabled = env => env === 'production'
  ? process.env.NUITEE_FLIGHTS_BOOKING_ENABLED === 'true'
  : process.env.NUITEE_SANDBOX_FLIGHTS_BOOKING_ENABLED === 'true';
const secret = () => process.env.FLIGHT_CHECKOUT_SECRET || process.env.HOTEL_CHECKOUT_SECRET || dbKey();
const headers = () => ({ apikey: dbKey(), Authorization: 'Bearer ' + dbKey(), 'Content-Type': 'application/json' });
const db = async (table, query = '', options = {}) => {
  const response = await fetch(base() + '/rest/v1/' + table + query, {
    method: options.method || 'GET',
    headers: { ...headers(), ...(options.prefer ? { Prefer: options.prefer } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  if (!response.ok) throw Error('storage');
  if (response.status === 204 || String(options.prefer || '').toLowerCase().includes('return=minimal')) return [];
  return response.json();
};
const sign = id => {
  const body = Buffer.from(JSON.stringify({ id, env: bookingEnv(), exp: Date.now() + 2 * 60 * 60 * 1000 })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret()).update('flight-checkout|' + body).digest('base64url');
};
const verify = token => {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature || !secret()) throw Error('token');
  const expected = crypto.createHmac('sha256', secret()).update('flight-checkout|' + body).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Error('token');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.id || payload.exp < Date.now() || payload.env !== bookingEnv()) throw Error('token');
  return payload;
};
const load = async token => {
  const auth = verify(token);
  const rows = await db('flight_checkouts', '?id=eq.' + encodeURIComponent(auth.id) + '&limit=1');
  if (!rows.length || rows[0].environment !== auth.env) throw Error('checkout');
  return rows[0];
};
const flightSummary = value => {
  if (!value || typeof value !== 'object') throw Error('summary');
  const segments = Array.isArray(value.segments) ? value.segments.slice(0, 12).map(s => ({
    direction: clean(s.direction).slice(0, 20),
    originCode: clean(s.originCode).slice(0, 8),
    destinationCode: clean(s.destinationCode).slice(0, 8),
    departureTime: clean(s.departureTime).slice(0, 40),
    arrivalTime: clean(s.arrivalTime).slice(0, 40),
    carrier: clean(s.carrier).slice(0, 100),
    flightNumber: clean(s.flightNumber).slice(0, 30)
  })) : [];
  if (!segments.length) throw Error('summary');
  const price = Number(value.price);
  const currency = clean(value.currency).toUpperCase();
  if (!Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) throw Error('summary');
  return { segments, price, currency, origin: segments[0].originCode, destination: segments[0].destinationCode, departure: segments[0].departureTime, return: segments.find(s => s.direction === 'INBOUND')?.departureTime || null };
};
const normalizePassengers = (value, count, expectedTypes) => {
  if (!Array.isArray(value) || value.length !== count || count < 1 || count > 9 || !Array.isArray(expectedTypes) || expectedTypes.length !== count) throw Error('passengers');
  return value.map((p, index) => {
    const passengerType = Number(expectedTypes[index]);
    if (![0, 1, 2].includes(passengerType)) throw Error('passengers');
    const firstName = clean(p.firstName).slice(0, 100), lastName = clean(p.lastName).slice(0, 100);
    const birthday = clean(p.birthday), documentNumber = clean(p.documentNumber).replace(/\s/g, '').slice(0, 40);
    const documentType = clean(p.documentType).toLowerCase();
    const nationality = clean(p.nationality || 'AR').toUpperCase(), documentIssueCountry = clean(p.documentIssueCountry || nationality).toUpperCase();
    const documentExpiry = clean(p.documentExpiry), gender = clean(p.gender).toUpperCase();
    if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !documentNumber || !['passport', 'id'].includes(documentType) || !/^[A-Z]{2}$/.test(nationality) || !/^[A-Z]{2}$/.test(documentIssueCountry) || !/^\d{4}-\d{2}-\d{2}$/.test(documentExpiry) || !['M','F'].includes(gender)) throw Error('passengers');
    return { passengerType, firstName, lastName, birthday, gender, nationality, documentType, documentNumber, documentIssueCountry, documentExpiry };
  });
};
const providerErrorDetails = body => {
  const data = body?.data && !Array.isArray(body.data) ? body.data : {};
  const error = body?.error;
  const message = typeof error === 'string' ? error : error?.message || body?.message || data?.message || '';
  const code = body?.code || body?.errorCode || error?.code || data?.code || '';
  return { message: clean(message).slice(0, 500), code: clean(code).slice(0, 80) };
};
const flightProviderError = (status, details) => {
  const text = (details.code + ' ' + details.message).toLowerCase();
  if (details.code === '43001') return 'Nuitee requiere habilitar el medio de pago de vuelos para esta cuenta (error 43001). No se realizó ningún cobro; contactá a soporte.';
  if (status === 401) return 'Nuitee rechazó la clave de vuelos configurada.';
  if (status === 403) return 'Nuitee todavía no habilitó las reservas de vuelos para esta cuenta.';
  if (status === 404 || /expired|sold.?out|offer not found|flight info changed|session expired|not available/.test(text)) return 'La tarifa del vuelo venció, cambió o se agotó mientras completabas los datos. Volvé a la búsqueda y elegí un vuelo actualizado.';
  if (status === 400 && /passenger|document|nationality|birthday|contact|invalid/.test(text)) return 'Nuitee rechazó algún dato del pasajero o del contacto. Revisá los datos ingresados y el documento.';
  if (status === 400) return 'Nuitee rechazó la solicitud del vuelo. La tarifa o alguno de los datos no se pudo validar; volvé a elegir el vuelo y revisá los datos.';
  if (status === 429) return 'Nuitee recibió demasiadas consultas en poco tiempo. Esperá unos minutos antes de volver a intentarlo.';
  return 'Nuitee no pudo confirmar temporalmente la tarifa. No se abrió el pago; volvé a consultar vuelos antes de intentarlo de nuevo.';
};
const parseResult = async response => {
  const body = await response.json().catch(() => ({}));
  const data = Array.isArray(body.data) ? body.data[0] : body.data || body;
  return { body, data };
};
async function prepare(req, res) {
  const env = bookingEnv(), key = apiKey(env);
  if (!key || !enabled(env)) return json(res, 503, { error: env === 'production' ? 'El pago de vuelos todavía no está habilitado para esta cuenta. No se realizó ningún cargo.' : 'El checkout de vuelos de prueba no está habilitado en este entorno.' });
  if (!base() || !dbKey() || !secret()) return json(res, 503, { error: 'No pudimos preparar el registro seguro del vuelo.' });
  const input = req.body || {}, offerId = clean(input.offerId), contact = input.contact || {};
  const phoneCountryCode = clean(contact.phoneCountryCode).replace(/\D/g, '');
  const phoneNumber = clean(contact.phoneNumber).replace(/\D/g, '');
  let summary, passengers;
  try {
    summary = flightSummary(input.flight);
    const adults = Number(input.passengerCounts?.adults), children = Number(input.passengerCounts?.children || 0), infants = Number(input.passengerCounts?.infants || 0);
    const count = adults + children + infants;
    if (!Number.isInteger(adults) || adults < 1 || adults > 9 || !Number.isInteger(children) || children < 0 || !Number.isInteger(infants) || infants < 0 || count > 9) throw Error('passengers');
    const passengerTypes = [...Array(adults).fill(0), ...Array(children).fill(1), ...Array(infants).fill(2)];
    passengers = normalizePassengers(input.passengers, count, passengerTypes);
    if (!offerId || offerId.length > 800 || !clean(contact.firstName) || !clean(contact.lastName) || !emailOK(clean(contact.email)) || !/^\d{1,4}$/.test(phoneCountryCode) || phoneNumber.length < 6 || phoneNumber.length > 24) throw Error('contact');
  } catch {
    return json(res, 400, { error: 'Completá los datos de contacto y los datos de cada pasajero para continuar.' });
  }
  try { await db('flight_checkouts', '?select=id&limit=0'); }
  catch { return json(res, 503, { error: 'Falta preparar el registro seguro de pagos de vuelos.' }); }
  try {
    const verification = await fetch('https://api.liteapi.travel/v3.0/flights/verify', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ offerId }),
      signal: AbortSignal.timeout(20000)
    });
    const { body: verificationBody, data: verificationData } = await parseResult(verification);
    if (!verification.ok || verificationBody.error) {
      const status = verification.status;
      const details = providerErrorDetails(verificationBody);
      console.warn('Nuitee flight verification rejected', { status, code: details.code });
      return json(res, status >= 500 ? 502 : status || 502, { error: flightProviderError(status, details), providerStatus: status });
    }
    const changes = verificationData?.changes;
    if (changes && (Array.isArray(changes) ? changes.length : typeof changes === 'object' ? Object.keys(changes).length : Boolean(changes))) {
      return json(res, 409, { error: 'La tarifa o las condiciones del vuelo cambiaron desde la búsqueda. Volvé a Viaje completo, revisá la opción actualizada y confirmala antes de continuar.', reason: 'offer_changed' });
    }
    const response = await fetch('https://api.liteapi.travel/v3.0/flights/prebooks', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        offerId, usePaymentSdk: true,
        contact: { firstName: clean(contact.firstName).slice(0, 100), lastName: clean(contact.lastName).slice(0, 100), email: clean(contact.email).toLowerCase(), phoneCountryCode, phoneNumber },
        passengers
      }),
      signal: AbortSignal.timeout(25000)
    });
    const { body, data } = await parseResult(response);
    if (!response.ok || body.error) {
      const status = response.status;
      const details = providerErrorDetails(body);
      console.warn('Nuitee flight prebook rejected', { status, code: details.code });
      return json(res, status >= 500 ? 502 : status || 502, { error: flightProviderError(status, details), providerStatus: status });
    }
    if (!data.prebookId || !data.transactionId || !data.secretKey || !Number.isFinite(Number(data.price))) return json(res, 502, { error: 'Nuitee no devolvió los datos necesarios para pagar este vuelo.' });
    const expiresAt = data.reservationExpiresAt || data.expiresAt || null;
    const id = crypto.randomUUID(), clientReference = 'VAL-F-' + crypto.randomUUID();
    await db('flight_checkouts', '', { method: 'POST', prefer: 'return=minimal', body: {
      id, environment: env, prebook_id: data.prebookId, transaction_id: data.transactionId, client_reference: clientReference,
      email: clean(contact.email).toLowerCase(), flight: summary, price: Number(data.price), currency: clean(data.currency || summary.currency).toUpperCase(),
      state: 'prepared', expires_at: expiresAt, provider_result: { reservationExpiresAt: expiresAt, servicesAttachable: data.servicesAttachable || null }
    }});
    return json(res, 200, {
      checkoutToken: sign(id), prebookId: data.prebookId, transactionId: data.transactionId,
      paymentSecret: data.secretKey, paymentPublicKey: env === 'production' ? 'live' : 'sandbox',
      publishableKey: data.publishableKey || null, price: Number(data.price), currency: clean(data.currency || summary.currency).toUpperCase(),
      reservationExpiresAt: expiresAt, servicesAttachable: data.servicesAttachable || null, bookingEnvironment: env
    });
  } catch (error) {
    console.error('Nuitee flight prebook failed', error?.message || error);
    return json(res, 502, { error: 'No se pudo reservar temporalmente esta tarifa. Volvé a consultar vuelos.' });
  }
}
async function book(req, res) {
  const env = bookingEnv(), key = apiKey(env);
  if (!key || !enabled(env)) return json(res, 503, { error: 'El pago de vuelos no está habilitado. No vuelvas a pagar; consultá Mi cuenta o contactá a Valijeando.' });
  let row;
  try { row = await load(req.body?.checkoutToken); }
  catch { return json(res, 401, { error: 'La sesión de pago del vuelo venció. No se creó otra reserva.' }); }
  if (row.state === 'confirmed' && row.provider_booking_id) return json(res, 200, { ok: true, status: 'CONFIRMED', bookingId: row.provider_booking_id, bookingRef: row.booking_ref, saved: true, alreadyConfirmed: true, flight: row.flight });
  if (row.state === 'booking') return json(res, 409, { error: 'La confirmación del vuelo está en proceso. No vuelvas a pagar.', reason: 'booking_uncertain' });
  if (!['prepared','uncertain'].includes(row.state) || (row.state === 'prepared' && row.expires_at && Date.parse(row.expires_at) < Date.now())) return json(res, 409, { error: 'La tarifa reservada venció. No se creó el vuelo; volvé a buscar y empezá de nuevo.', reason: 'expired' });
  const claimed = await db('flight_checkouts', '?id=eq.' + encodeURIComponent(row.id) + '&state=in.(prepared,uncertain)', { method: 'PATCH', prefer: 'return=representation', body: { state: 'booking', updated_at: new Date().toISOString() } });
  if (claimed.length !== 1) return json(res, 409, { error: 'La confirmación del vuelo ya está en proceso. No vuelvas a pagar.', reason: 'booking_uncertain' });
  try {
    const response = await fetch('https://api.liteapi.travel/v3.0/flights/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prebookId: row.prebook_id, payment: { method: 'TRANSACTION_ID', transactionId: row.transaction_id } }),
      signal: AbortSignal.timeout(30000)
    });
    const { body, data } = await parseResult(response);
    if (!response.ok || body.error) {
      const uncertain = response.status >= 500 || response.status === 408;
      await db('flight_checkouts', '?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', prefer: 'return=minimal', body: { state: uncertain ? 'uncertain' : 'rejected', updated_at: new Date().toISOString() } }).catch(() => {});
      return json(res, uncertain ? 502 : response.status || 502, { error: uncertain ? 'No pudimos confirmar el estado del vuelo. No vuelvas a pagar; consultá Mi cuenta antes de reintentar.' : 'Nuitee no confirmó la reserva del vuelo. Volvé a consultar la tarifa.', reason: uncertain ? 'booking_uncertain' : 'provider_rejected' });
    }
    const bookingId = clean(data.bookingId || data.id), airlineRef = data.booking?.order?.reference?.airlineBookings?.[0]?.airlinePnr || data.order?.reference?.airlineBookings?.[0]?.airlinePnr || '', bookingRef = clean(data.bookingRef || data.bookingReference || data.pnr || airlineRef || data.booking?.order?.reference?.orderId || data.order?.reference?.orderId || '');
    const providerStatus = clean(data.status || '').toUpperCase();
    const confirmed = Boolean(bookingId) && ['CONFIRMED', 'TICKETED', 'OK'].includes(providerStatus);
    const pending = Boolean(bookingId) && ['PENDING_CONFIRMATION', 'PENDING', 'PROCESSING'].includes(providerStatus);
    if (!bookingId || (!confirmed && !pending)) {
      await db('flight_checkouts', '?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', prefer: 'return=minimal', body: { state: 'uncertain', provider_result: { status: providerStatus }, updated_at: new Date().toISOString() } }).catch(() => {});
      return json(res, 202, { ok: true, status: 'PENDING_CONFIRMATION', error: 'Nuitee está terminando de confirmar el vuelo. No vuelvas a pagar; si sigue pendiente, contactá a Valijeando.', bookingId: bookingId || null, flight: row.flight });
    }
    const status = confirmed ? 'confirmada' : 'pendiente';
    await db('reservas_vuelos', '?on_conflict=provider_booking_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
      email: row.email, proveedor: 'Nuitee', provider_booking_id: bookingId, booking_ref: bookingRef || null,
      origen: row.flight.origin, destino: row.flight.destination, salida: row.flight.departure || null, regreso: row.flight.return || null,
      moneda: row.currency, total: row.price, estado: status, itinerario: row.flight.segments, creado_en: new Date().toISOString()
    }});
    await db('flight_checkouts', '?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', prefer: 'return=minimal', body: { state: confirmed ? 'confirmed' : 'pending_confirmation', provider_booking_id: bookingId, booking_ref: bookingRef || null, provider_result: { status: providerStatus }, updated_at: new Date().toISOString() } });
    return json(res, confirmed ? 200 : 202, { ok: true, status: providerStatus, bookingId, bookingRef: bookingRef || null, saved: true, flight: row.flight, price: row.price, currency: row.currency });
  } catch (error) {
    await db('flight_checkouts', '?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', prefer: 'return=minimal', body: { state: 'uncertain', updated_at: new Date().toISOString() } }).catch(() => {});
    console.error('Nuitee flight booking status uncertain', error?.message || error);
    return json(res, 202, { error: 'No pudimos verificar el resultado del pago y la reserva. No vuelvas a pagar; podés volver a consultar la confirmación con el mismo prebook.', reason: 'booking_uncertain' });
  }
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return json(res, 200, { environment: bookingEnv(), enabled: enabled(bookingEnv()), sdk: enabled(bookingEnv()) ? 'TRANSACTION_ID' : null });
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' });
  if (req.body?.action === 'prepare') return prepare(req, res);
  if (req.body?.action === 'book') return book(req, res);
  return json(res, 400, { error: 'Acción de vuelo inválida.' });
}

export const RATEHAWK_SANDBOX_HOTEL_IDS = Object.freeze([10004834, 8819557]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidRateHawkDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRateHawkSearch(body = {}, now = new Date()) {
  const checkin = String(body.checkin || '');
  const checkout = String(body.checkout || '');
  if (!isValidRateHawkDate(checkin) || !isValidRateHawkDate(checkout) || checkout <= checkin) {
    return { error: 'Revisá las fechas de entrada y salida.' };
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const lastCheckin = new Date(`${today}T00:00:00.000Z`);
  lastCheckin.setUTCDate(lastCheckin.getUTCDate() + 730);
  if (checkin < today || checkin > lastCheckin.toISOString().slice(0, 10)) {
    return { error: 'La entrada debe ser desde hoy y hasta 730 días en el futuro.' };
  }

  const nights = (Date.parse(`${checkout}T00:00:00.000Z`) - Date.parse(`${checkin}T00:00:00.000Z`)) / 86400000;
  if (nights > 30) return { error: 'RateHawk permite consultar hasta 30 noches por búsqueda.' };

  const guests = Array.isArray(body.guests) ? body.guests : [{ adults: Number(body.adults ?? 2), children: body.children || [] }];
  if (!guests.length || guests.length > 9) return { error: 'Elegí entre 1 y 9 habitaciones.' };
  const normalizedGuests = [];
  for (const room of guests) {
    const adults = Number(room?.adults);
    const children = Array.isArray(room?.children) ? room.children.map(Number) : [];
    if (!Number.isInteger(adults) || adults < 1 || adults > 6 || children.length > 4 || children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) {
      return { error: 'Revisá adultos y edades de los menores en cada habitación.' };
    }
    normalizedGuests.push({ adults, children });
  }

  const requestedIds = Array.isArray(body.hids) ? body.hids.map(Number) : RATEHAWK_SANDBOX_HOTEL_IDS;
  const hids = [...new Set(requestedIds)].filter(id => RATEHAWK_SANDBOX_HOTEL_IDS.includes(id));
  if (!hids.length) return { error: 'La búsqueda de certificación debe incluir el hotel Sandbox 10004834 o 8819557.' };

  const residency = String(body.residency || 'ar').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(residency)) return { error: 'La residencia debe ser un código de país ISO de dos letras.' };

  return {
    value: {
      checkin,
      checkout,
      residency,
      language: 'en',
      guests: normalizedGuests,
      hids,
      currency: 'USD',
    },
  };
}

export function rateHawkSandboxAuthorization(env = process.env) {
  const keyId = String(env.RATEHAWK_SANDBOX_KEY_ID || '').trim();
  const apiKey = String(env.RATEHAWK_SANDBOX_API_KEY || '').trim();
  if (!keyId || !apiKey) return null;
  return `Basic ${Buffer.from(`${keyId}:${apiKey}`).toString('base64')}`;
}

export async function rateHawkSandboxRequest(path, body, { env = process.env, fetchImpl = fetch } = {}) {
  const authorization = rateHawkSandboxAuthorization(env);
  if (!authorization) throw new Error('RATEHAWK_SANDBOX_CREDENTIALS_MISSING');

  return fetchImpl(`https://api-sandbox.ratehawk.com/api/b2b/v3/${path.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
}

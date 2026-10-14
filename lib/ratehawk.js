const HOSTS = Object.freeze({
  sandbox: 'https://api-sandbox.ratehawk.com',
  production: 'https://api.ratehawk.com'
});

const API_PREFIX = '/api/b2b/v3/';

export class RatehawkApiError extends Error {
  constructor(status, code = 'provider_error') {
    super(`RateHawk request failed (${code}).`);
    this.name = 'RatehawkApiError';
    this.status = status;
    this.code = code;
  }
}

export function ratehawkEnvironment(env = process.env) {
  const value = String(env.RATEHAWK_ENV || 'sandbox').trim().toLowerCase();
  return Object.hasOwn(HOSTS, value) ? value : 'unknown';
}

export function ratehawkConfig(env = process.env) {
  const mode = ratehawkEnvironment(env);
  const keyId = String(env.RATEHAWK_KEY_ID || '').trim();
  const apiKey = String(env.RATEHAWK_API_KEY || '').trim();
  return {
    mode,
    host: HOSTS[mode] || null,
    configured: Boolean(HOSTS[mode] && keyId && apiKey),
    keyId,
    apiKey,
    liveBookingEnabled: mode === 'production' && env.RATEHAWK_LIVE_BOOKING_ENABLED === 'true'
  };
}

export function createRatehawkClient({
  mode = 'sandbox',
  keyId,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  allowProduction = false
} = {}) {
  if (!Object.hasOwn(HOSTS, mode)) throw new Error('RATEHAWK_ENV must be sandbox or production.');
  if (mode === 'production' && !allowProduction) throw new Error('RateHawk production access is disabled.');
  if (!String(keyId || '').trim() || !String(apiKey || '').trim()) throw new Error('RateHawk credentials are not configured.');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this runtime.');

  const host = HOSTS[mode];
  const authorization = 'Basic ' + Buffer.from(`${keyId}:${apiKey}`).toString('base64');

  return async function request(endpoint, payload) {
    if (typeof endpoint !== 'string' || !endpoint.startsWith(API_PREFIX) || endpoint.includes('..') || endpoint.includes('?') || endpoint.includes('#')) {
      throw new Error('RateHawk endpoint is outside the allowed API path.');
    }
    const response = await fetchImpl(host + endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(timeoutMs)
    });

    let data;
    try { data = await response.json(); }
    catch { throw new RatehawkApiError(response.status, 'invalid_response'); }

    const providerError = data?.error;
    if (!response.ok || providerError || data?.status === 'error') {
      const code = typeof providerError === 'string'
        ? providerError
        : String(providerError?.code || data?.status || `http_${response.status}`);
      throw new RatehawkApiError(response.status, code);
    }
    return data;
  };
}

export function createRatehawkClientFromEnv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = ratehawkConfig(env);
  if (!config.configured) throw new Error('RateHawk sandbox credentials are not configured.');
  return createRatehawkClient({
    mode: config.mode,
    keyId: config.keyId,
    apiKey: config.apiKey,
    fetchImpl,
    allowProduction: config.liveBookingEnabled
  });
}

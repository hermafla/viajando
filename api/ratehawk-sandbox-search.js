import { rateHawkSandboxRequest, validateRateHawkSearch } from '../lib/ratehawk.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  const validated = validateRateHawkSearch(req.body || {});
  if (validated.error) return res.status(400).json({ error: validated.error });

  try {
    const response = await rateHawkSandboxRequest('search/serp/hotels/', validated.value);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error' || payload.error) {
      const providerCode = String(payload.error || payload.debug?.validation_error || '').slice(0, 80);
      console.error('RateHawk Sandbox search rejected', response.status, providerCode || 'provider_error');
      return res.status(502).json({ error: 'RateHawk no pudo completar la búsqueda Sandbox.', providerCode: providerCode || null });
    }

    return res.status(200).json({
      provider: 'ratehawk',
      environment: 'sandbox',
      hotelIds: validated.value.hids,
      data: payload.data || {},
    });
  } catch (error) {
    if (error?.message === 'RATEHAWK_SANDBOX_CREDENTIALS_MISSING') {
      return res.status(503).json({ error: 'Faltan configurar las claves de RateHawk Sandbox.' });
    }
    console.error('RateHawk Sandbox search failed:', error?.name || 'Error');
    return res.status(502).json({ error: 'No pudimos conectar con RateHawk Sandbox.' });
  }
}

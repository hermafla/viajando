import test from 'node:test';
import assert from 'node:assert/strict';
import { createRatehawkClient, createRatehawkClientFromEnv, ratehawkConfig, ratehawkEnvironment } from '../lib/ratehawk.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('RateHawk defaults to sandbox and reports missing credentials without exposing any key', () => {
  assert.equal(ratehawkEnvironment({}), 'sandbox');
  assert.deepEqual(ratehawkConfig({}), {
    mode: 'sandbox', host: 'https://api-sandbox.ratehawk.com', configured: false,
    keyId: '', apiKey: '', liveBookingEnabled: false
  });
});

test('unknown environment is rejected instead of selecting a host implicitly', () => {
  assert.equal(ratehawkEnvironment({ RATEHAWK_ENV: 'staging' }), 'unknown');
  assert.throws(() => createRatehawkClient({ mode: 'staging', keyId: 'id', apiKey: 'secret' }), /must be sandbox or production/);
});

test('sandbox client uses ETG Basic auth and the sandbox host', async () => {
  let seen;
  const request = createRatehawkClient({
    mode: 'sandbox', keyId: 'sample-id', apiKey: 'sample-secret',
    fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse({ data: { status: 'ok' }, status: 'ok', error: null }); }
  });
  const result = await request('/api/b2b/v3/search/serp/region/', { region_id: 2011 });
  assert.equal(result.status, 'ok');
  assert.equal(seen.url, 'https://api-sandbox.ratehawk.com/api/b2b/v3/search/serp/region/');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.Authorization, 'Basic ' + Buffer.from('sample-id:sample-secret').toString('base64'));
  assert.deepEqual(JSON.parse(seen.options.body), { region_id: 2011 });
});

test('client refuses arbitrary hosts and path traversal', async () => {
  const request = createRatehawkClient({ mode: 'sandbox', keyId: 'id', apiKey: 'secret', fetchImpl: async () => { throw Error('should not fetch'); } });
  await assert.rejects(request('https://api.ratehawk.com/api/b2b/v3/search/serp/region/', {}), /outside the allowed/);
  await assert.rejects(request('/api/b2b/v3/../content/private', {}), /outside the allowed/);
});

test('production mode stays blocked until the separate live-booking flag is explicit', async () => {
  assert.equal(ratehawkConfig({ RATEHAWK_ENV: 'production', RATEHAWK_KEY_ID: 'id', RATEHAWK_API_KEY: 'secret' }).liveBookingEnabled, false);
  assert.throws(() => createRatehawkClient({ mode: 'production', keyId: 'id', apiKey: 'secret' }), /production access is disabled/);
  assert.throws(() => createRatehawkClientFromEnv({ env: { RATEHAWK_ENV: 'production', RATEHAWK_KEY_ID: 'id', RATEHAWK_API_KEY: 'secret' } }), /production access is disabled/);
  const productionRequest = createRatehawkClientFromEnv({
    env: { RATEHAWK_ENV: 'production', RATEHAWK_KEY_ID: 'id', RATEHAWK_API_KEY: 'secret', RATEHAWK_LIVE_BOOKING_ENABLED: 'true' },
    fetchImpl: async () => jsonResponse({ status: 'ok' })
  });
  assert.equal((await productionRequest('/api/b2b/v3/hotel/order/cancel/', { partner_order_id: 'fixture' })).status, 'ok');
});

test('provider errors never expose credential material', async () => {
  const request = createRatehawkClient({
    mode: 'sandbox', keyId: 'private-id', apiKey: 'private-secret',
    fetchImpl: async () => jsonResponse({ status: 'error', error: 'rate_not_found' }, 200)
  });
  await assert.rejects(request('/api/b2b/v3/hotel/prebook/', { hash: 'fixture' }), error => {
    assert.match(error.message, /rate_not_found/);
    assert.doesNotMatch(error.message, /private-id|private-secret/);
    return true;
  });
});

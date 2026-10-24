import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ratehawk-sandbox-search.js';
import { rateHawkSandboxAuthorization, validateRateHawkSearch } from '../lib/ratehawk.js';

function responseMock() {
  return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } };
}

test('sandbox search is fixed to the two certification hotel IDs by default', () => {
  const result = validateRateHawkSearch({ checkin: '2027-01-10', checkout: '2027-01-12' }, new Date('2026-10-24T00:00:00Z'));
  assert.deepEqual(result.value.hids, [10004834, 8819557]);
  assert.deepEqual(result.value.guests, [{ adults: 2, children: [] }]);
  assert.equal(result.value.residency, 'ar');
  assert.equal(result.value.currency, 'USD');
});

test('sandbox search can request mixed occupants across rooms for certification scenarios', () => {
  const result = validateRateHawkSearch({
    checkin: '2027-01-10', checkout: '2027-01-12', residency: 'UZ', hids: [10004834],
    guests: [{ adults: 2, children: [3] }, { adults: 2, children: [1, 5, 17] }],
  }, new Date('2026-10-24T00:00:00Z'));
  assert.deepEqual(result.value.guests, [{ adults: 2, children: [3] }, { adults: 2, children: [1, 5, 17] }]);
  assert.deepEqual(result.value.hids, [10004834]);
  assert.equal(result.value.residency, 'uz');
});

test('invalid dates, stay lengths, occupants and unrelated hotel IDs are rejected', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  assert.ok(validateRateHawkSearch({ checkin: '2027-02-30', checkout: '2027-03-02' }, now).error);
  assert.ok(validateRateHawkSearch({ checkin: '2027-01-01', checkout: '2027-02-01' }, now).error);
  assert.ok(validateRateHawkSearch({ checkin: '2027-01-10', checkout: '2027-01-12', guests: [{ adults: 0, children: [] }] }, now).error);
  assert.ok(validateRateHawkSearch({ checkin: '2027-01-10', checkout: '2027-01-12', hids: [8473727] }, now).error);
});

test('Sandbox auth uses only server environment values and HTTP Basic', () => {
  assert.equal(rateHawkSandboxAuthorization({}), null);
  assert.equal(rateHawkSandboxAuthorization({ RATEHAWK_SANDBOX_KEY_ID: 'id', RATEHAWK_SANDBOX_API_KEY: 'secret' }), `Basic ${Buffer.from('id:secret').toString('base64')}`);
});

test('search returns configuration guidance without contacting RateHawk when keys are missing', async () => {
  const oldId = process.env.RATEHAWK_SANDBOX_KEY_ID;
  const oldKey = process.env.RATEHAWK_SANDBOX_API_KEY;
  delete process.env.RATEHAWK_SANDBOX_KEY_ID;
  delete process.env.RATEHAWK_SANDBOX_API_KEY;
  try {
    const res = responseMock();
    await handler({ method: 'POST', body: { checkin: '2027-01-10', checkout: '2027-01-12' } }, res);
    assert.equal(res.code, 503);
    assert.match(res.data.error, /Sandbox/);
  } finally {
    if (oldId === undefined) delete process.env.RATEHAWK_SANDBOX_KEY_ID; else process.env.RATEHAWK_SANDBOX_KEY_ID = oldId;
    if (oldKey === undefined) delete process.env.RATEHAWK_SANDBOX_API_KEY; else process.env.RATEHAWK_SANDBOX_API_KEY = oldKey;
  }
});

test('sandbox search sends authenticated request with the certification HIDs and hides provider debug data', async () => {
  const oldId = process.env.RATEHAWK_SANDBOX_KEY_ID;
  const oldKey = process.env.RATEHAWK_SANDBOX_API_KEY;
  process.env.RATEHAWK_SANDBOX_KEY_ID = 'sandbox-id';
  process.env.RATEHAWK_SANDBOX_API_KEY = 'sandbox-secret';
  const oldFetch = globalThis.fetch;
  let actualUrl, actualOptions;
  globalThis.fetch = async (url, options) => {
    actualUrl = url; actualOptions = options;
    return new Response(JSON.stringify({ status: 'ok', data: { hotels: [{ hid: 10004834 }] }, debug: { private: 'omit' } }));
  };
  try {
    const res = responseMock();
    await handler({ method: 'POST', body: { checkin: '2027-01-10', checkout: '2027-01-12' } }, res);
    assert.equal(res.code, 200);
    assert.equal(actualUrl, 'https://api-sandbox.ratehawk.com/api/b2b/v3/search/serp/hotels/');
    assert.equal(actualOptions.headers.Authorization, `Basic ${Buffer.from('sandbox-id:sandbox-secret').toString('base64')}`);
    assert.deepEqual(JSON.parse(actualOptions.body).hids, [10004834, 8819557]);
    assert.deepEqual(res.data.data, { hotels: [{ hid: 10004834 }] });
    assert.equal('debug' in res.data, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldId === undefined) delete process.env.RATEHAWK_SANDBOX_KEY_ID; else process.env.RATEHAWK_SANDBOX_KEY_ID = oldId;
    if (oldKey === undefined) delete process.env.RATEHAWK_SANDBOX_API_KEY; else process.env.RATEHAWK_SANDBOX_API_KEY = oldKey;
  }
});

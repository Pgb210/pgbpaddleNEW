import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { getDb } from '../db/index.js';
import { createCancellationToken, customerCancellation, hashCancellationToken } from '../netlify/lib/cancellation.js';
import { checkAvailability, serializeBooking, validateBooking, courtName } from '../netlify/lib/booking.js';
import { sendConfirmationEmail, deliverCancellationNotice, sendRejectionEmail, sendRequestNotification } from '../netlify/lib/email.js';
import cancelHandler from '../netlify/functions/cancel-booking.mts';

const pg = new PGlite();
for (const directory of (await readdir(new URL('../netlify/database/migrations/', import.meta.url))).sort()) {
  await pg.exec(await readFile(new URL(`../netlify/database/migrations/${directory}/migration.sql`, import.meta.url), 'utf8'));
}
const db = drizzle({ client: pg, schema });
const serviceDb = db as unknown as ReturnType<typeof getDb>;
const base = { name: 'Court Customer', email: 'customer@example.test', bookingDate: '2099-07-15', slotTime: '09:00', endTime: '10:00' };
async function seed(overrides = {}) {
  const cancellation = createCancellationToken();
  const [booking] = await db.insert(schema.bookings).values({ ...base, ...overrides, cancellationTokenHash: cancellation.hash }).returning();
  return { booking, ...cancellation };
}
async function empty() {
  await db.delete(schema.bookingRequests);
  await db.delete(schema.bookings);
  await db.delete(schema.cancellationNotices);
}

test('256-bit tokens are unique; only hashes are stored and serializers expose neither', async () => {
  const tokens = Array.from({ length: 1000 }, createCancellationToken);
  assert.equal(new Set(tokens.map(t => t.token)).size, 1000);
  assert.ok(tokens.every(t => /^[a-f0-9]{64}$/.test(t.token) && t.hash !== t.token && hashCancellationToken(t.token) === t.hash));
  const { booking } = await seed();
  assert.ok(!JSON.stringify(serializeBooking(booking)).includes(booking.cancellationTokenHash!));
});

test('view is read-only; cancellation frees slot, consumes token, updates request and preserves another customer', async () => {
  await empty();
  const first = await seed();
  const other = await seed({ email: 'other@example.test', slotTime: '11:00', endTime: '12:00' });
  await db.insert(schema.bookingRequests).values({ ...base, bookingId: first.booking.id, status: 'APPROVED' });
  const viewed = await customerCancellation(first.token, false, serviceDb);
  assert.equal(viewed.booking_date, base.bookingDate);
  assert.equal((await db.select().from(schema.bookings)).length, 2);
  await assert.rejects(db.transaction(tx => checkAvailability(tx as never, base)), /already booked/);
  await customerCancellation(first.token, true, serviceDb);
  await db.transaction(tx => checkAvailability(tx as never, base));
  assert.deepEqual((await db.select().from(schema.bookings)).map(b => b.id), [other.booking.id]);
  const [request] = await db.select().from(schema.bookingRequests);
  assert.equal(request.status, 'CANCELLED');
  assert.equal(request.bookingId, null);
  assert.equal((await db.select().from(schema.cancellationNotices)).length, 1);
  await assert.rejects(customerCancellation(first.token, true, serviceDb), /invalid or has already been used/);
  await assert.rejects(customerCancellation(first.token, false, serviceDb));
});

test('booking IDs, missing, malformed, unknown and modified tokens never authorize cancellation', async () => {
  await empty();
  const { token, booking } = await seed();
  for (const invalid of [undefined, null, 42, booking.id, '', 'x'.repeat(64), createCancellationToken().token, `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`]) {
    await assert.rejects(customerCancellation(invalid, true, serviceDb));
  }
  assert.equal((await db.select().from(schema.bookings)).length, 1);
});

test('past and already-started bookings cannot be viewed or cancelled', async () => {
  await empty();
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  for (const overrides of [{ bookingDate: '2020-01-01' }, { bookingDate: now.slice(0, 10), slotTime: now.slice(11, 16) }]) {
    const { token } = await seed(overrides);
    await assert.rejects(customerCancellation(token, false, serviceDb), /before the booking starts/);
    await assert.rejects(customerCancellation(token, true, serviceDb), /before the booking starts/);
  }
  assert.equal((await db.select().from(schema.bookings)).length, 2);
});

test('cutoff SQL interprets Dublin winter and summer correctly', async () => {
  const { rows } = await pg.query<{ summer: string; winter: string }>(`SELECT ('2099-07-15 09:00'::timestamp AT TIME ZONE 'Europe/Dublin')::text AS summer, ('2099-01-15 09:00'::timestamp AT TIME ZONE 'Europe/Dublin')::text AS winter`);
  assert.match(rows[0].summer, /08:00:00/);
  assert.match(rows[0].winter, /09:00:00/);
});

test('concurrent confirmations succeed once and queue one pair of notifications', async () => {
  await empty();
  const { token } = await seed();
  const results = await Promise.allSettled([customerCancellation(token, true, serviceDb), customerCancellation(token, true, serviceDb)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await db.select().from(schema.cancellationNotices)).length, 1);
});

test('failed notice persistence rolls back the cancellation', async () => {
  await empty();
  const { booking, token } = await seed();
  await db.insert(schema.cancellationNotices).values({ ...base, bookingId: booking.id });
  await assert.rejects(customerCancellation(token, true, serviceDb));
  assert.equal((await db.select().from(schema.bookings)).length, 1);
});

test('admin deletion still works and invalidates private link', async () => {
  await empty();
  const { booking, token } = await seed();
  await db.delete(schema.bookings).where(eq(schema.bookings.id, booking.id));
  await assert.rejects(customerCancellation(token, true, serviceDb));
});

test('pending holds, two-hour maximum, opening hours and conflict checks remain enforced', async () => {
  await empty();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const body = { name: base.name, email: base.email, booking_date: today, slot_time: '09:00', end_time: '11:00', court: courtName };
  assert.equal(validateBooking(body, true).endTime, '11:00');
  assert.throws(() => validateBooking({ ...body, end_time: '11:30' }, true), /2 hours/);
  assert.throws(() => validateBooking({ ...body, slot_time: '06:30', end_time: '07:30' }, true), /7 AM/);
  assert.throws(() => validateBooking({ ...body, slot_time: '09:15' }, true));
  await db.insert(schema.bookingRequests).values({ ...base, status: 'PENDING' });
  await assert.rejects(db.transaction(tx => checkAvailability(tx as never, base)), /pending/);
});

test('endpoint blocks cross-origin confirmation, GET and bad actions without database access', async () => {
  assert.equal((await cancelHandler(new Request('https://preview.example.test/api/cancel-booking'))).status, 405);
  assert.equal((await cancelHandler(new Request('https://preview.example.test/api/cancel-booking', { method: 'POST', headers: { Origin: 'https://attacker.example.test' } }))).status, 403);
  assert.equal((await cancelHandler(new Request('https://preview.example.test/api/cancel-booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: 'arbitrary' }) }))).status, 400);
});

test('confirmation includes private preview link; cancellation delivers both recipients and retries only failures', async () => {
  await empty();
  const { booking, token } = await seed({ name: '<script>unsafe</script>' });
  const calls: { body: { to: string[]; html: string; subject: string }; key: string | null }[] = [];
  let failAdmin = false;
  const originalFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  // Synthetic test-only configuration: no real credentials or deliveries.
  globalThis.Netlify = { env: { get: (key: string) => ({ RESEND_API_KEY: 'test-placeholder', BOOKING_REQUEST_ADMIN_EMAILS: 'admin-one@example.test;admin-two@example.test;ADMIN-ONE@example.test' })[key] } } as never;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    calls.push({ body, key: new Headers(options!.headers).get('Idempotency-Key') });
    return new Response(null, { status: failAdmin && body.to.includes('admin-one@example.test') ? 503 : 200 });
  };
  try {
    await sendConfirmationEmail(booking, token, 'https://preview.example.test');
    assert.ok(calls[0].body.html.includes(`https://preview.example.test/cancel-booking.html#${token}`));
    assert.ok(!calls[0].body.html.includes('<script>'));
    await customerCancellation(token, true, serviceDb);
    const [notice] = await db.select().from(schema.cancellationNotices);
    failAdmin = true;
    assert.deepEqual(await deliverCancellationNotice(notice, serviceDb), { customerSent: true, adminSent: false });
    assert.deepEqual(calls[2].body.to, ['admin-one@example.test', 'admin-two@example.test']);
    failAdmin = false;
    const [retry] = await db.select().from(schema.cancellationNotices);
    assert.deepEqual(await deliverCancellationNotice(retry, serviceDb), { customerSent: true, adminSent: true });
    assert.equal(calls.length, 4);
    assert.equal(calls[2].key, calls[3].key);
    assert.ok(!JSON.stringify(calls.slice(1)).includes(token));
    const [finished] = await db.select().from(schema.cancellationNotices);
    await deliverCancellationNotice(finished, serviceDb);
    assert.equal(calls.length, 4);
    const [request] = await db.insert(schema.bookingRequests).values(base).returning();
    await sendRejectionEmail(request);
    await sendRequestNotification(request);
    assert.match(calls[4].body.html, /pending hold has been released/);
    assert.match(calls[5].body.html, /pending admin approval/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = previousNetlify;
  }
});

test.after(async () => { await pg.close(); });

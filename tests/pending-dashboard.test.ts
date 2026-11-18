import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const pending = [
  { id: '8156182e-cd6c-4459-baa5-7f9b25c54c3f', name: 'Preview Test', email: 'test@example.test', court: 'PGB Padel Court', bookingDate: '2026-10-30', slotTime: '17:00', endTime: '17:30', status: 'PENDING', notificationSent: true },
  { id: '8d9f5f9b-db01-430c-877c-b98b520d0c0f', name: 'Earlier Preview Test', email: 'test@example.test', court: 'PGB Padel Court', bookingDate: '2026-10-30', slotTime: '07:00', endTime: '07:30', status: 'PENDING', notificationSent: true },
];

async function dashboard(sessionWorks = true) {
  const dom = new JSDOM(html, { url: 'https://preview.example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const calls: { path: string; options: RequestInit }[] = [];
  dom.window.setInterval = () => { throw new Error('Availability must not poll'); };
  let signedIn = false;
  dom.window.fetch = async (path: string, options: RequestInit = {}) => {
    calls.push({ path, options });
    if (path === '/api/session') {
      if (options.method === 'POST') { signedIn = sessionWorks; return Response.json({ role: 'admin' }); }
      return Response.json({ role: signedIn ? 'admin' : null });
    }
    if (path === '/api/bookings') return Response.json([]);
    if (path === '/api/booking-requests') return signedIn ? Response.json(pending) : Response.json({ error: 'Admin login is required.' }, { status: 403 });
    throw new Error(`Unexpected fetch: ${path}`);
  };
  for (const script of scripts) runInContext(script, dom.getInternalVMContext());
  await new Promise(resolve => setImmediate(resolve));
  const document = dom.window.document;
  document.getElementById('adminEmail')!.value = 'admin@example.test';
  document.getElementById('adminPassword')!.value = 'synthetic-test-password';
  await dom.window.loginAdmin();
  await new Promise(resolve => setImmediate(resolve));
  return { dom, document, calls };
}

test('authenticated admin loads every pending request regardless of selected date or elapsed start time', async () => {
  const { dom, document, calls } = await dashboard();
  try {
    assert.equal(document.getElementById('pendingCard')!.style.display, 'block');
    assert.equal(document.getElementById('pendingCount')!.textContent, '2');
    assert.equal(document.querySelectorAll('.pending-item').length, 2);
    assert.match(document.getElementById('pendingBody')!.textContent!, /5 PM/);
    assert.match(document.getElementById('pendingBody')!.textContent!, /7 AM/);
    assert.equal(document.getElementById('pendingAlert')!.hidden, false);
    assert.equal(calls.find(call => call.path === '/api/booking-requests')!.options.cache, 'no-store');
    await dom.window.fetchPendingRequests();
    assert.equal(document.querySelectorAll('.pending-item').length, 2);
  } finally { dom.window.close(); }
});

test('missing session displays an explicit admin authorization error rather than an empty pending list', async () => {
  const { dom, document } = await dashboard(false);
  try {
    assert.match(document.getElementById('pendingBody')!.textContent!, /Admin login is required/);
    assert.doesNotMatch(document.getElementById('pendingBody')!.textContent!, /no pending requests/);
  } finally { dom.window.close(); }
});


test('availability refreshes on date selection and manual refresh, and stays quiet while hidden', async () => {
  const { dom, document, calls } = await dashboard();
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const reads = () => calls.filter(call => call.path === '/api/bookings').length;
  try {
    const initial = reads();
    assert.ok(initial > 0, 'loads on opening');
    const nextDay = document.querySelector('.cal-day:not(:disabled):not(.selected)') as HTMLButtonElement;
    nextDay.click();
    await settle();
    assert.equal(reads(), initial + 1);
    (document.getElementById('refreshAvailability') as HTMLButtonElement).click();
    await settle();
    assert.equal(reads(), initial + 2);
    assert.equal((document.getElementById('refreshAvailability') as HTMLButtonElement).disabled, false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await dom.window.refreshAvailability();
    assert.equal(reads(), initial + 2, 'no reads in background');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await settle();
    assert.equal(reads(), initial + 3, 'refreshes once on foreground return');
    const pendingReads = calls.filter(call => call.path === '/api/booking-requests').length;
    assert.equal(pendingReads, reads() - 1, 'admin requests refresh alongside availability');
  } finally { dom.window.close(); }
});

test('admin cancellation reloads authoritative availability', async () => {
  const { dom, calls } = await dashboard();
  try {
    const before = calls.filter(call => call.path === '/api/bookings' && !call.options.method).length;
    const originalFetch = dom.window.fetch;
    dom.window.fetch = async (path: string, options: RequestInit = {}) => {
      if (options.method === 'DELETE') return Response.json({ ok: true });
      return originalFetch(path, options);
    };
    await dom.window.deleteBooking('test-booking');
    assert.equal(calls.filter(call => call.path === '/api/bookings' && !call.options.method).length, before + 1);
  } finally { dom.window.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createCancellationToken } from '../netlify/lib/cancellation.js';

const source = await readFile(new URL('../cancel-booking.js', import.meta.url), 'utf8');

test('page removes token from history, shows date/time, and only cancels on explicit confirmation', async () => {
  const { token } = createCancellationToken();
  const elements = Object.fromEntries(['status', 'details', 'cancel', 'confirmation', 'date', 'time', 'h1'].map(id => [id, { textContent: '', hidden: id === 'details', disabled: false }]));
  let submit: (event: { preventDefault(): void }) => Promise<void>;
  const calls: Record<string, unknown>[] = [];
  let scrubbed = false;
  const context = {
    location: { hash: `#${token}`, pathname: '/cancel-booking.html' },
    history: { replaceState: (_state: unknown, _title: string, path: string) => { assert.equal(path, '/cancel-booking.html'); scrubbed = true; } },
    document: {
      getElementById: (id: string) => id === 'confirmation' ? { addEventListener: (_event: string, callback: typeof submit) => { submit = callback; } } : elements[id],
      querySelector: () => elements.h1,
    },
    fetch: async (url: string, options: { body: string }) => {
      assert.ok(scrubbed);
      assert.equal(url, '/api/cancel-booking');
      const body = JSON.parse(options.body);
      calls.push(body);
      return Response.json(body.action === 'view' ? { booking_date: '2099-07-15', slot_time: '09:00', end_time: '10:00' } : { cancelled: true, email_sent: true });
    },
  };
  runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'view');
  assert.equal(elements.details.hidden, false);
  assert.match(elements.date.textContent, /2099/);
  assert.match(elements.time.textContent, /09:00 – 10:00/);
  await submit!({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, 'cancel');
  assert.equal(calls[1].token, token);
  assert.equal(elements.details.hidden, true);
  assert.equal(elements.h1.textContent, 'Booking cancelled');
  assert.match(elements.status.textContent, /emailed/);
  await submit!({ preventDefault() {} });
  assert.equal(calls.length, 2);
});

test('invalid link shows an error and never reveals confirmation controls', async () => {
  const status = { textContent: '' };
  const details = { hidden: true };
  runInNewContext(source, {
    location: { hash: '', pathname: '/cancel-booking.html' },
    history: { replaceState() {} },
    document: { getElementById: (id: string) => id === 'status' ? status : id === 'details' ? details : { addEventListener() {} } },
    fetch: async () => Response.json({ error: 'This cancellation link is invalid or has already been used.' }, { status: 404 }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(status.textContent, /invalid/);
  assert.equal(details.hidden, true);
});

(() => {
  // A fragment is never sent in page requests or Referer headers. Keep it out of history too.
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('status');
  const details = document.getElementById('details');
  const button = document.getElementById('cancel');
  async function send(action) {
    const response = await fetch('/api/cancel-booking', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to process this cancellation. Please try again.');
    return result;
  }
  document.getElementById('confirmation').addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Cancelling your booking…';
    try {
      const result = await send('cancel');
      details.hidden = true;
      document.querySelector('h1').textContent = 'Booking cancelled';
      status.textContent = result.email_sent
        ? 'Your time slot is available again. A cancellation confirmation has been emailed to you.'
        : 'Your time slot is available again. Your cancellation confirmation email is queued for delivery.';
    } catch (error) {
      status.textContent = error.message || 'Unable to connect. Please try again.';
      button.disabled = false;
    }
  });
  send('view').then(booking => {
    document.getElementById('date').textContent = new Date(`${booking.booking_date}T00:00:00Z`).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    document.getElementById('time').textContent = `${booking.slot_time} – ${booking.end_time} (Europe/Dublin)`;
    status.textContent = 'Please review your booking before confirming cancellation.';
    details.hidden = false;
  }).catch(error => { status.textContent = error.message || 'Unable to connect. Please open your email link again to retry.'; });
})();

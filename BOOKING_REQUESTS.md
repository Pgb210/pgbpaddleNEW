# Public booking requests

The home page is public and shows the existing single PGB Padel Court, its next
30 bookable dates, and available half-hour times between 08:00 and 22:00. Public
visitors submit their name, email, and optional phone number. Every submission
is saved as `PENDING`; it never creates a confirmed booking or reserves a slot.
Dates in the public booking window follow the club's Europe/Dublin time zone.

Public booking requests may last from 30 minutes to a maximum of 2 consecutive
hours, in half-hour increments. The end-time selector only offers durations
within that limit, and the request API rejects longer ranges even if a visitor
bypasses the form. Direct admin bookings and previously submitted requests
remain unchanged; no database migration is required for this limit.

Staff use the existing Admin email/password login or Viewer PIN login via the
Staff login button. No Netlify Identity account or new authentication provider
is required. Credential verification now takes place on the server because
browser-only checks cannot protect a public booking API. The existing direct
booking, cancellation, credential settings, and Viewer controls remain present.
Public availability responses do not disclose booked customers' contact details.

## Preview configuration

Configure these server-side environment variables with Functions scope for the
preview context, without putting their values in source control:

- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: the existing staff login credentials.
- `VIEWER_PIN`: the existing viewer PIN, if Viewer access is needed.
- `RESEND_API_KEY`: the existing email integration's API key.
- `BOOKING_CONFIRMATION_FROM_EMAIL`: a sender authorized by the email provider.
- `BOOKING_REQUEST_ADMIN_EMAIL`: the admin notification recipient (optional;
  falls back to the saved admin email, then `ADMIN_EMAIL`).

The first successful configuration-based login initializes the private settings
record with hashed credentials. After that, the existing Admin Settings controls
save credential changes in Netlify Database; initialization variables do not
overwrite saved settings. Admin sessions use signed, HttpOnly, SameSite cookies
and expire after 12 hours. Changing the password invalidates older admin sessions.

Deploy Preview admin authentication uses the Function's trusted deployment
context to make `ADMIN_EMAIL` and `ADMIN_PASSWORD` authoritative for login and
session validation, without overwriting saved credentials or changing Viewer
authentication. Missing or invalid environment credentials fail closed rather
than falling back to saved hashes. In previews, the Admin Settings password-save
action returns an explanation that credentials are managed in Netlify. Other
contexts, including production, retain the existing saved-settings login and
password controls. No additional configuration flag is required.
The previously browser-bundled login values were removed from the public page.
Staff login fails closed with a configuration message if it is not configured.
Public browsing and requests do not require a staff account.

The new additive migration creates `booking_requests` and `admin_settings`.
It does not change the existing `bookings` table or modify either previously
applied migration. Netlify applies it to the preview database during deployment.
Do not publish the preview to production until configuration and review are complete.

## Admin review and notifications

Pending Requests lists all unreviewed requests, their contact information, and
requested dates/times. The dashboard displays a pending count and a notification
banner and checks for new requests every 30 seconds while open.

Each new request also attempts to send an admin email through the existing email
integration. Email failure does not discard the request: the dashboard marks the
undelivered notification and offers a retry. Email requires the configuration
above; the default email-provider sender may restrict recipients.

Approve atomically checks availability, creates the confirmed booking, and marks
the request `APPROVED`. The normal booking confirmation email is then sent to
the requester. Concurrent approvals and direct admin bookings share a
transactional, date-specific database lock, so overlapping confirmed bookings
cannot be created through these endpoints. If a conflict occurs, the request
remains pending for review. Repeat approval is rejected.

Reject marks the request `REJECTED` without creating a booking. The slot remains
available unless another confirmed booking occupies it. Pending requests can
overlap each other; they are not reservations. Cancelling an approved booking
uses the existing admin cancellation control.

## Preview acceptance checks

1. Open the preview without logging in. Check date navigation, the single court,
   available times, and the absence of customer contact information.
2. Submit a request and verify the pending acknowledgment, admin email, and
   Pending Requests entry. Confirm that public visitors cannot create/delete
   confirmed bookings or approve/reject requests, including direct API calls.
3. Approve the request. Verify one confirmed booking, the requester confirmation
   email, and the occupied time range on the public page.
4. Submit two overlapping requests and approve them concurrently. Only one
   should become confirmed. Also test approval versus direct admin booking.
5. Reject a request and verify that it creates no booking and does not occupy
   the slot. Check existing direct booking and cancellation controls.
6. Verify notification failure/retry behavior, staff logout, Viewer access, and
   both existing Admin Settings controls.

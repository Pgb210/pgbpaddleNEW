# Public booking requests

The home page is public and shows the existing single PGB Padel Court, its next
30 bookable dates, and available half-hour start times from 07:00 through 22:30,
with bookings ending no later than 23:00. Public
visitors submit their name, email, and optional phone number. Every submission
is saved as `PENDING`; it temporarily holds the requested time range without
creating a confirmed booking. Public and Admin availability label those slots
“Booking pending”. Held slots cannot be selected or included in a new request.
Dates in the public booking window follow the club's Europe/Dublin time zone.

Public booking requests may last from 30 minutes to a maximum of 2 consecutive
hours, in half-hour increments. The end-time selector only offers durations
within that limit, and the request API rejects longer ranges even if a visitor
bypasses the form. Direct admin bookings and previously submitted requests
remain unchanged; no database migration is required for this limit.

Staff use the existing Admin email/password login via the Staff login button.
Availability browsing and public booking requests do not require a login.
The unused Viewer PIN login and settings controls were removed; legacy Viewer
sessions are treated as unauthenticated public sessions. No Netlify Identity
account or new authentication provider
is required. Credential verification now takes place on the server because
browser-only checks cannot protect a public booking API. The existing direct
booking, cancellation, and Admin credential settings controls remain present.
Public availability responses do not disclose booked customers' contact details.
Pending holds expose only the date, start/end times, and `PENDING` status to all
availability users; requester identities and contact details remain admin-only.

## Preview configuration

Configure these server-side environment variables with Functions scope for the
preview context, without putting their values in source control:

- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: the existing staff login credentials.
- `RESEND_API_KEY`: the existing email integration's API key.
- `BOOKING_CONFIRMATION_FROM_EMAIL`: a sender authorized by the email provider.
- `BOOKING_REQUEST_ADMIN_EMAILS`: optional comma-, semicolon-, or newline-separated
  admin notification recipients. Whitespace and duplicate addresses are removed,
  and each request sends one notification email addressed to the entire list.
- `BOOKING_REQUEST_ADMIN_EMAIL`: the legacy single admin notification recipient
  used when the plural setting is empty; falls back to the saved admin email,
  then `ADMIN_EMAIL`.

These settings affect only pending-request admin notifications. Customer booking
confirmations keep their existing recipient, sender, subject, content, and
idempotency key and are sent only for confirmed bookings.

The first successful configuration-based login initializes the private settings
record with hashed credentials. After that, the existing Admin Settings controls
save credential changes in Netlify Database; initialization variables do not
overwrite saved settings. Admin sessions use signed, HttpOnly, SameSite cookies
and expire after 12 hours. Changing the password invalidates older admin sessions.

Deploy Preview admin authentication uses the Function's trusted deployment
context to make `ADMIN_EMAIL` and `ADMIN_PASSWORD` authoritative for login and
session validation, without overwriting saved credentials. Missing or invalid
environment credentials fail closed rather
than falling back to saved hashes. In previews, the Admin Settings password-save
action returns an explanation that credentials are managed in Netlify. Other
contexts, including production, retain the existing saved-settings login and
password controls. No additional configuration flag is required.
The previously browser-bundled login values were removed from the public page.
Staff login fails closed with a configuration message if it is not configured.
Public browsing and requests do not require a staff account.

The original request migration created `booking_requests` and `admin_settings`.
An additional migration permits the `CANCELLED` request status. It does not
change the existing `bookings` table or modify any previously applied migration.
Netlify applies pending migrations to the preview database during deployment.
Do not publish the preview to production until configuration and review are complete.

Viewer PIN environment configuration is no longer read or required. The legacy
nullable PIN-hash database column and historical migrations are retained unused
to preserve the existing database schema and migration history.

Database clients are initialized lazily during requests through Netlify Database
so Function runtime connection bindings are available before connecting. The
existing tables, transaction locks, and conflict checks remain unchanged.

## Admin review and notifications

Pending Requests lists all unreviewed requests, their contact information, and
requested dates/times. The dashboard displays a pending count and a notification
banner and checks for new requests every 30 seconds while open.

Each new request also attempts to send an admin email through the existing email
integration. Email failure does not discard the request: the dashboard marks the
undelivered notification and offers a retry. Email requires the configuration
above; the default email-provider sender may restrict recipients.

Approve atomically checks availability (excluding only the request's own hold),
creates the confirmed booking, and marks the request `APPROVED`. The normal
booking confirmation email is then sent to the requester. Availability reads
use a consistent snapshot so this transition has no visible gap. New requests,
approvals, rejections, cancellations, and direct admin bookings share a
transactional, date-specific database lock. Both confirmed bookings and pending
holds block overlapping requests and admin bookings, including direct API calls.
If a conflict occurs, the request remains pending for review. Repeat approval
and other repeated review actions are rejected.

Reject marks the request `REJECTED`; Cancel request marks it `CANCELLED`. Both
admin actions release the hold immediately without creating a booking or sending
a confirmation email. Open pages refresh availability every 30 seconds, and the
acting admin's page refreshes immediately. Legacy overlapping pending requests
continue to hold their ranges; an admin must reject or cancel the conflicting
request before approving the other. Cancelling an approved booking uses the
existing admin booking cancellation control. Notifications, email retry behavior,
authentication, and confirmation email content remain unchanged.

## Preview acceptance checks

1. Open the preview without logging in. Check date navigation, the single court,
   available times, and the absence of customer contact information.
2. Submit a request and verify the pending acknowledgment, admin email, and
   Pending Requests entry. Confirm that public visitors cannot create/delete
   confirmed bookings or approve/reject requests, including direct API calls.
3. Approve the request. Verify one confirmed booking, the requester confirmation
   email, and the occupied time range on the public page.
4. Attempt a duplicate, partial overlap, containing range, and contained range
   through the public request API and the admin booking API. Expect HTTP 409.
   Submit overlapping requests concurrently; only one should become pending.
   Adjacent half-hour ranges should remain available. Also test simultaneous
   approval and direct admin booking, and repeated review actions.
5. Reject or cancel a pending request and verify that it creates no booking,
   sends no confirmation email, and immediately releases its hold for the next
   API request. Check Public and Admin pending labels, unselectable held slots,
   and refreshed open-slot counts. Check existing admin booking cancellation.
6. Verify notification failure/retry behavior, secure Admin login and logout,
   and the existing Admin credential settings control. Confirm that Viewer
   login attempts are rejected, old Viewer cookies do not authenticate or
   disclose booking contacts, and the PIN settings endpoint is no longer active.

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

The admin recipient settings affect only pending-request admin notifications.
Rejection emails use the existing email integration and sender configuration and
are addressed only to the requester. Customer booking confirmations keep their
existing recipient, sender, subject, content, and idempotency key and are sent only
for confirmed bookings.

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
a confirmation email. After a rejection commits, the requester receives an email
with their requested date and time, explaining that the request was not approved,
the hold was released, and they can submit another request. Cancellation does not
send this email. The existing locked, pending-only review transition allows only
one rejection email attempt per request, including concurrent reviews. The email
provider also receives a separate `rejection-<request ID>` idempotency key.
Delivery failure does not undo the rejection or restore the hold; the admin sees
whether the email was sent. Repeated review actions cannot resend it. No schema
change or migration was needed. Open pages refresh availability every 30 seconds, and the
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
   API request. Rejection sends exactly one requester email with the requested
   date/time, released-hold explanation, and invitation to submit another request;
   cancellation sends no requester email. Repeat and concurrently submit reject
   actions and verify HTTP 409 for subsequent reviews and no extra emails. Test
   email failure and verify the rejection and released hold persist, with a failed
   delivery message in Admin. Check Public and Admin pending labels, unselectable held slots,
   and refreshed open-slot counts. Check existing admin booking cancellation.
6. Verify notification failure/retry behavior, secure Admin login and logout,
   and the existing Admin credential settings control. Confirm that Viewer
   login attempts are rejected, old Viewer cookies do not authenticate or
   disclose booking contacts, and the PIN settings endpoint is no longer active.

## Confirmed booking self-cancellation

New approved bookings and bookings created directly by an admin include a private cancellation link in their confirmation email. The link opens `/cancel-booking.html`, displays the date and time, and requires an explicit confirmation. Possession of the random 256-bit token authorizes cancellation of only its associated booking. Only a SHA-256 hash is stored; booking IDs never authorize this operation. Tokens stay in the email URL fragment, are removed from browser history on page load, and are submitted in JSON bodies rather than URLs. Avoid logging request bodies for this endpoint.

The database checks the booking start in `Europe/Dublin` after acquiring the existing date lock. Cancellation atomically deletes the booking and token, marks the originating approved request `CANCELLED`, and queues customer and admin notifications. Removing the booking releases availability immediately. Existing admin deletion and authentication remain unchanged. Previously sent confirmation emails are not retroactively modified.

Cancellation emails use the existing Resend configuration and the same configured admin recipient precedence as booking-request notifications. A durable notification record tracks customer and admin delivery separately. Failed deliveries use stable idempotency keys and are retried by `cancellation-emails` every ten minutes on published deploys. Scheduled functions do not automatically execute in Deploy Previews; immediate cancellation emails still run there.

### Validation

`npm test` runs database integration tests against an isolated PGlite PostgreSQL instance, applies the migration chain to that test database, and mocks outbound email delivery. It also exercises the confirmation-page script. `npm run typecheck` checks the server TypeScript. These tests do not send real emails or touch site data.

Before promoting a Deploy Preview, verify the following on its isolated database using bookings and email addresses controlled by the tester:

1. Submit a request, approve it as admin, and follow the confirmation email link on the preview hostname. Also verify a direct admin-created booking includes a working link.
2. Verify opening the link leaves availability unchanged and shows the correct date and time. Explicitly cancel, check slot availability, verify the request becomes cancelled, and check receipt of customer and configured admin emails.
3. Try the link again, a modified token, a booking ID alone, and a link belonging to an admin-deleted booking. All must fail. Confirm a second customer's booking is unchanged.
4. Submit simultaneous cancellations and a competing request for that time. Verify one cancellation succeeds and the normal conflict rules apply when the slot is claimed again.
5. Verify cancellation at and after booking start fails, including Dublin daylight-saving dates. Check that the admin can still delete the booking directly.
6. Recheck rejection emails, pending cancellation, pending holds, two-hour maximum, opening hours, and admin/viewer authentication.
7. Simulate email failure only with preview configuration or a controlled mock, confirm the slot stays released, and manually invoke the scheduled retry in the test environment to verify delivery flags and recipient selection.

Live preview checks and real email delivery must be recorded separately from the local automated test results. Do not use copied real customer bookings for cancellation tests or publish to production as part of preview validation.

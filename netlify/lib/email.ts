import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { bookings, bookingRequests, cancellationNotices } from "../../db/schema.js";
import { getSettings } from "./auth.js";
import { courtName, escapeHtml, formatDateLabel } from "./booking.js";

async function sendEmail(to: string | string[], subject: string, html: string, idempotencyKey: string): Promise<boolean> {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const recipients = Array.isArray(to) ? to : to ? [to] : [];
  if (!apiKey || !recipients.length) {
    console.warn("Booking email configuration is incomplete; email was not sent.");
    return false;
  }
  const fromEmail = Netlify.env.get("BOOKING_CONFIRMATION_FROM_EMAIL") || "onboarding@resend.dev";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: `PGB Sports Paddle Court <${fromEmail}>`, to: recipients, subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) console.warn("Booking email delivery failed.");
    return response.ok;
  } catch {
    console.warn("Booking email delivery was unavailable.");
    return false;
  }
}

export function sendConfirmationEmail(booking: typeof bookings.$inferSelect, token: string, origin: string) {
  return sendEmail(booking.email, "Your paddle court booking is confirmed", `
    <p>Hi ${escapeHtml(booking.name)},</p><p>Your paddle court booking is confirmed:</p>
    <ul><li><strong>Court:</strong> ${courtName}</li><li><strong>Date:</strong> ${formatDateLabel(booking.bookingDate)}</li>
    <li><strong>Time:</strong> ${booking.slotTime} – ${booking.endTime}</li></ul><p>See you on the court!</p>
    <p><a href="${escapeHtml(`${origin}/cancel-booking.html#${token}`)}">Cancel booking</a></p>
    <p>This private link only cancels this booking. Keep it private. Cancellation is available until the booking starts (Europe/Dublin time).</p>
  `, `confirmation-${booking.id}`);
}

export function sendRejectionEmail(bookingRequest: typeof bookingRequests.$inferSelect) {
  return sendEmail(bookingRequest.email, "Your PGB Padel booking request was not approved", `
    <p>Hi ${escapeHtml(bookingRequest.name)},</p>
    <p>Your requested paddle court date and time were not approved:</p>
    <ul><li><strong>Court:</strong> ${courtName}</li><li><strong>Date:</strong> ${formatDateLabel(bookingRequest.bookingDate)}</li>
    <li><strong>Time:</strong> ${bookingRequest.slotTime} – ${bookingRequest.endTime}</li></ul>
    <p>Your pending hold has been released. Please visit PGB Padel Booking to view available slots and submit another request.</p>
  `, `rejection-${bookingRequest.id}`);
}

export async function sendRequestNotification(bookingRequest: typeof bookingRequests.$inferSelect) {
  const to = await adminRecipients();
  return sendEmail(to, "New PGB Padel booking request — approval needed", `
    <p>A new booking request is pending admin approval.</p>
    <ul><li><strong>Name:</strong> ${escapeHtml(bookingRequest.name)}</li>
    <li><strong>Email:</strong> ${escapeHtml(bookingRequest.email)}</li>
    <li><strong>Phone:</strong> ${escapeHtml(bookingRequest.phone || "Not provided")}</li>
    <li><strong>Court:</strong> ${courtName}</li><li><strong>Date:</strong> ${formatDateLabel(bookingRequest.bookingDate)}</li>
    <li><strong>Time:</strong> ${bookingRequest.slotTime} – ${bookingRequest.endTime}</li></ul>
    <p>Open PGB Padel Booking, log in as Admin, and review Pending Requests. This request is not a confirmed booking.</p>
  `, `request-${bookingRequest.id}`);
}

async function adminRecipients() {
  const configuredRecipients = Netlify.env.get("BOOKING_REQUEST_ADMIN_EMAILS") || "";
  const recipients = [...new Set(configuredRecipients.split(/[,;\n]+/).map(recipient => recipient.trim().toLowerCase()).filter(Boolean))];
  return recipients.length ? recipients : Netlify.env.get("BOOKING_REQUEST_ADMIN_EMAIL") || (await getSettings())?.adminEmail || Netlify.env.get("ADMIN_EMAIL") || "";
}

export async function deliverCancellationNotice(notice: typeof cancellationNotices.$inferSelect, db = getDb()) {
  const details = `<ul><li><strong>Court:</strong> ${courtName}</li><li><strong>Date:</strong> ${formatDateLabel(notice.bookingDate)}</li><li><strong>Time:</strong> ${notice.slotTime} – ${notice.endTime} (Europe/Dublin)</li></ul>`;
  let customerSent = notice.customerSent;
  let adminSent = notice.adminSent;
  if (!customerSent) {
    customerSent = await sendEmail(notice.email, "Your PGB Padel booking has been cancelled", `<p>Hi ${escapeHtml(notice.name)},</p><p>Your booking has been cancelled and the time slot is available again.</p>${details}`, `cancellation-customer-${notice.bookingId}`);
    if (customerSent) await db.update(cancellationNotices).set({ customerSent: true }).where(eq(cancellationNotices.bookingId, notice.bookingId));
  }
  if (!adminSent) {
    adminSent = await sendEmail(await adminRecipients(), "PGB Padel booking cancelled by customer", `<p>${escapeHtml(notice.name)} (${escapeHtml(notice.email)}) cancelled their confirmed booking. The time slot has been released.</p>${details}`, `cancellation-admin-${notice.bookingId}`);
    if (adminSent) await db.update(cancellationNotices).set({ adminSent: true }).where(eq(cancellationNotices.bookingId, notice.bookingId));
  }
  return { customerSent, adminSent };
}

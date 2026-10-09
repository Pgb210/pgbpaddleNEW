import { bookings, bookingRequests } from "../../db/schema.js";
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

export function sendConfirmationEmail(booking: typeof bookings.$inferSelect) {
  return sendEmail(booking.email, "Your paddle court booking is confirmed", `
    <p>Hi ${escapeHtml(booking.name)},</p><p>Your paddle court booking is confirmed:</p>
    <ul><li><strong>Court:</strong> ${courtName}</li><li><strong>Date:</strong> ${formatDateLabel(booking.bookingDate)}</li>
    <li><strong>Time:</strong> ${booking.slotTime} – ${booking.endTime}</li></ul><p>See you on the court!</p>
  `, `confirmation-${booking.id}`);
}

export async function sendRequestNotification(bookingRequest: typeof bookingRequests.$inferSelect) {
  const configuredRecipients = Netlify.env.get("BOOKING_REQUEST_ADMIN_EMAILS") || "";
  const recipients = [...new Set(configuredRecipients.split(/[,;\n]+/).map(recipient => recipient.trim().toLowerCase()).filter(Boolean))];
  const to = recipients.length ? recipients : Netlify.env.get("BOOKING_REQUEST_ADMIN_EMAIL") || (await getSettings())?.adminEmail || Netlify.env.get("ADMIN_EMAIL") || "";
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

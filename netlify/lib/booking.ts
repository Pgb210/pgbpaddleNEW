import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import { ApiError } from "./http.js";

export const courtName = "PGB Padel Court";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validateBooking(body: Record<string, unknown>, publicRequest = false) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const bookingDate = typeof body.booking_date === "string" ? body.booking_date : "";
  const slotTime = typeof body.slot_time === "string" ? body.slot_time : "";
  const endTime = typeof body.end_time === "string" ? body.end_time : "";
  const date = new Date(`${bookingDate}T00:00:00Z`);
  if (!name || name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== bookingDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slotTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime) || endTime <= slotTime) {
    throw new ApiError(400, "Invalid booking details.");
  }
  if (publicRequest) {
    const startMinutes = Number(slotTime.slice(0, 2)) * 60 + Number(slotTime.slice(3));
    const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
    if (endMinutes - startMinutes > 120) {
      throw new ApiError(400, "Booking requests cannot exceed 2 hours. Please choose a shorter time range.");
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const lastDate = new Date(`${today}T00:00:00Z`);
    lastDate.setUTCDate(lastDate.getUTCDate() + 29);
    if (bookingDate < today || bookingDate > lastDate.toISOString().slice(0, 10) || slotTime < "08:00" || endTime > "22:00" || !/:(00|30)$/.test(slotTime) || !/:(00|30)$/.test(endTime) || body.court !== courtName) {
      throw new ApiError(400, "Choose this court, an available date within 30 days, and times between 8 AM and 10 PM in half-hour steps.");
    }
  }
  return { name, email, bookingDate, slotTime, endTime };
}

export async function lockDate(transaction: Transaction, bookingDate: string) {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('pgb-court:' || ${bookingDate}))`);
}

export async function checkAvailability(transaction: Transaction, booking: { bookingDate: string; slotTime: string; endTime: string }) {
  const [overlap] = await transaction.select({ id: bookings.id }).from(bookings).where(and(
    eq(bookings.bookingDate, booking.bookingDate),
    lt(bookings.slotTime, booking.endTime),
    gt(bookings.endTime, booking.slotTime),
  )).limit(1);
  if (overlap) throw new ApiError(409, "This time range is already booked. Please choose another time.");
}

export function serializeBooking(booking: typeof bookings.$inferSelect) {
  return { id: booking.id, name: booking.name, email: booking.email, booking_date: booking.bookingDate, slot_time: booking.slotTime, end_time: booking.endTime };
}

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function formatDateLabel(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

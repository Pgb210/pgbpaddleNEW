import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { bookings, bookingRequests, cancellationNotices } from "../../db/schema.js";
import { ApiError } from "./http.js";
import { lockDate } from "./booking.js";

export function createCancellationToken() {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashCancellationToken(token) };
}
export function hashCancellationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function customerCancellation(token: unknown, confirm: boolean, db = getDb()) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(404, "This cancellation link is invalid or has already been used.");
  const hash = hashCancellationToken(token);
  return db.transaction(async transaction => {
    const [existing] = await transaction.select().from(bookings).where(eq(bookings.cancellationTokenHash, hash)).limit(1);
    if (!existing) throw new ApiError(404, "This cancellation link is invalid or has already been used.");
    await lockDate(transaction, existing.bookingDate);
    // Check after acquiring the date lock. PostgreSQL clock_timestamp advances even while waiting.
    const [booking] = await transaction.select().from(bookings).where(and(
      eq(bookings.cancellationTokenHash, hash),
      sql`((${bookings.bookingDate} + ${bookings.slotTime}::time) AT TIME ZONE 'Europe/Dublin') > clock_timestamp()`,
    )).for("update");
    if (!booking) throw new ApiError(409, "This booking can no longer be cancelled. Customer cancellation is only available before the booking starts.");
    if (confirm) {
      await transaction.insert(cancellationNotices).values({ bookingId: booking.id, name: booking.name, email: booking.email, bookingDate: booking.bookingDate, slotTime: booking.slotTime, endTime: booking.endTime });
      await transaction.update(bookingRequests).set({ status: "CANCELLED" }).where(eq(bookingRequests.bookingId, booking.id));
      // Deletion releases availability and destroys the only stored token hash atomically.
      await transaction.delete(bookings).where(eq(bookings.id, booking.id));
    }
    return { bookingId: booking.id, booking_date: booking.bookingDate, slot_time: booking.slotTime, end_time: booking.endTime };
  });
}

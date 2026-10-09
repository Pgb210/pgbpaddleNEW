import type { Config } from "@netlify/functions";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import { getRole, requireAdmin } from "../lib/auth.js";
import { checkAvailability, lockDate, serializeBooking, validateBooking } from "../lib/booking.js";
import { sendConfirmationEmail } from "../lib/email.js";
import { ApiError, checkOrigin, handleError, json, readBody } from "../lib/http.js";

export default async (request: Request) => {
  try {
    checkOrigin(request);
    if (request.method === "GET") {
      const role = await getRole(request);
      const rows = await db.select().from(bookings).orderBy(asc(bookings.bookingDate), asc(bookings.slotTime));
      return json(rows.map(booking => role ? serializeBooking(booking) : {
        booking_date: booking.bookingDate, slot_time: booking.slotTime, end_time: booking.endTime,
      }));
    }
    if (request.method === "POST") {
      await requireAdmin(request);
      const details = validateBooking(await readBody(request));
      const created = await db.transaction(async transaction => {
        await lockDate(transaction, details.bookingDate);
        await checkAvailability(transaction, details);
        const [created] = await transaction.insert(bookings).values(details).returning();
        return created;
      });
      const emailSent = await sendConfirmationEmail(created);
      return json({ ...serializeBooking(created), email_sent: emailSent }, 201);
    }
    if (request.method === "DELETE") {
      await requireAdmin(request);
      const id = new URL(request.url).searchParams.get("id");
      if (!id || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new ApiError(400, "A valid booking ID is required.");
      const [deleted] = await db.delete(bookings).where(eq(bookings.id, id)).returning({ id: bookings.id });
      if (!deleted) throw new ApiError(404, "Booking not found.");
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/bookings" };

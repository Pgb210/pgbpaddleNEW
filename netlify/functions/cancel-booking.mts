import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { cancellationNotices } from "../../db/schema.js";
import { customerCancellation } from "../lib/cancellation.js";
import { deliverCancellationNotice } from "../lib/email.js";
import { ApiError, checkOrigin, handleError, json, readBody } from "../lib/http.js";

export default async (request: Request) => {
  try {
    checkOrigin(request);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const body = await readBody(request);
    if (body.action !== "view" && body.action !== "cancel") throw new ApiError(400, "Choose a valid cancellation action.");
    const booking = await customerCancellation(body.token, body.action === "cancel");
    if (body.action === "view") return json({ booking_date: booking.booking_date, slot_time: booking.slot_time, end_time: booking.end_time });
    let emailSent = false;
    try {
      const db = getDb();
      const [notice] = await db.select().from(cancellationNotices).where(eq(cancellationNotices.bookingId, booking.bookingId));
      emailSent = (await deliverCancellationNotice(notice)).customerSent;
    } catch {
      console.warn("Cancellation saved; email delivery is pending retry.");
    }
    return json({ cancelled: true, email_sent: emailSent });
  } catch (error) {
    return handleError(error);
  }
};
export const config: Config = { path: "/api/cancel-booking" };

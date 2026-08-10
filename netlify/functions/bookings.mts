import type { Config, Context } from "@netlify/functions";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function formatDateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function sendConfirmationEmail(booking: typeof bookings.$inferSelect) {
  const apiKey = Netlify.env.get("re_EpajwWx4_D5n4y9X7EFhczbBoCZ6RTszo");
  if (!apiKey) {
    console.warn("RESEND_API_KEY is not set — skipping booking confirmation email.");
    return;
  }

  const fromEmail = Netlify.env.get("BOOKING_CONFIRMATION_FROM_EMAIL") || "onboarding@resend.dev";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `PGB Sports Paddle Court <${fromEmail}>`,
        to: [booking.email],
        subject: "Your paddle court booking is confirmed",
        html: `
          <p>Hi ${booking.name},</p>
          <p>Your paddle court booking is confirmed:</p>
          <ul>
            <li><strong>Date:</strong> ${formatDateLabel(booking.bookingDate)}</li>
            <li><strong>Time:</strong> ${booking.slotTime} – ${booking.endTime}</li>
            ${booking.team ? `<li><strong>Team:</strong> ${booking.team}</li>` : ""}
          </ul>
          <p>See you on the court!</p>
        `,
      }),
    });

    if (!res.ok) {
      console.error("Failed to send booking confirmation email", await res.text());
    }
  } catch (error) {
    console.error("Booking confirmation email error", error);
  }
}

function serializeBooking(booking: typeof bookings.$inferSelect) {
  return {
    id: booking.id,
    name: booking.name,
    email: booking.email,
    team: booking.team,
    booking_date: booking.bookingDate,
    slot_time: booking.slotTime,
    end_time: booking.endTime,
  };
}

export default async (request: Request, context: Context) => {
  try {
    if (request.method === "GET") {
      const rows = await db.select().from(bookings).orderBy(asc(bookings.bookingDate), asc(bookings.slotTime));
      return json(rows.map(serializeBooking));
    }

    if (request.method === "POST") {
      const body = await request.json();
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const team = typeof body.team === "string" ? body.team.trim() : "";
      const bookingDate = typeof body.booking_date === "string" ? body.booking_date : "";
      const slotTime = typeof body.slot_time === "string" ? body.slot_time : "";
      const endTime = typeof body.end_time === "string" ? body.end_time : "";

      if (!name || !email || !email.includes("@") || !datePattern.test(bookingDate) || !timePattern.test(slotTime) || !timePattern.test(endTime) || endTime <= slotTime) {
        return json({ error: "Invalid booking details." }, 400);
      }

      const [overlap] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(
          eq(bookings.bookingDate, bookingDate),
          lt(bookings.slotTime, endTime),
          gt(bookings.endTime, slotTime),
        ))
        .limit(1);

      if (overlap) return json({ error: "This time range is already booked." }, 409);

      const [created] = await db.insert(bookings).values({
        name,
        email,
        team,
        bookingDate,
        slotTime,
        endTime,
      }).returning();

      context.waitUntil(sendConfirmationEmail(created));

      return json(serializeBooking(created), 201);
    }

    if (request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ error: "Booking ID is required." }, 400);

      const [deleted] = await db.delete(bookings).where(eq(bookings.id, id)).returning({ id: bookings.id });
      if (!deleted) return json({ error: "Booking not found." }, 404);
      return new Response(null, { status: 204 });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("Bookings API error", error);
    return json({ error: "Unable to process the booking right now." }, 500);
  }
};

export const config: Config = {
  path: "/api/bookings",
};


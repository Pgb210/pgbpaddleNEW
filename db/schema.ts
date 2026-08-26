import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  bookingDate: date("booking_date", { mode: "string" }).notNull(),
  slotTime: text("slot_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


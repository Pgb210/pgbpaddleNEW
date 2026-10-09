import { boolean, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const bookings = pgTable("bookings", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  bookingDate: date("booking_date", { mode: "string" }).notNull(),
  slotTime: text("slot_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bookingRequests = pgTable("booking_requests", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text(),
  court: text().notNull().default("PGB Padel Court"),
  bookingDate: date("booking_date", { mode: "string" }).notNull(),
  slotTime: text("slot_time").notNull(),
  endTime: text("end_time").notNull(),
  status: text().notNull().default("PENDING"),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  notificationSent: boolean("notification_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("booking_requests_status_created_idx").on(table.status, table.createdAt),
  check("booking_requests_status_check", sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
]);

export const adminSettings = pgTable("admin_settings", {
  id: text().primaryKey(),
  adminEmail: text("admin_email").notNull(),
  passwordHash: text("password_hash").notNull(),
  viewerPinHash: text("viewer_pin_hash"),
});

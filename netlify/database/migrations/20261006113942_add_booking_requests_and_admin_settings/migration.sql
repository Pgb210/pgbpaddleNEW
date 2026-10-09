CREATE TABLE "admin_settings" (
	"id" text PRIMARY KEY,
	"admin_email" text NOT NULL,
	"password_hash" text NOT NULL,
	"viewer_pin_hash" text
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"court" text DEFAULT 'PGB Padel Court' NOT NULL,
	"booking_date" date NOT NULL,
	"slot_time" text NOT NULL,
	"end_time" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"booking_id" uuid,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "booking_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX "booking_requests_status_created_idx" ON "booking_requests" ("status","created_at");--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL;
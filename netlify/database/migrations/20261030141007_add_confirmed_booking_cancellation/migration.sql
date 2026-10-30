CREATE TABLE "cancellation_notices" (
	"booking_id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"booking_date" date NOT NULL,
	"slot_time" text NOT NULL,
	"end_time" text NOT NULL,
	"customer_sent" boolean DEFAULT false NOT NULL,
	"admin_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_token_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancellation_token_hash_key" UNIQUE("cancellation_token_hash");
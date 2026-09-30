ALTER TABLE "user" ADD COLUMN "last_active_day" date;
ALTER TABLE "user" ADD COLUMN "activity_streak" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone;

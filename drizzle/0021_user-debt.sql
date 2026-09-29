ALTER TABLE "user" ADD COLUMN "debt_cents" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "debt_rate_bps" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "debt_since" timestamp with time zone;

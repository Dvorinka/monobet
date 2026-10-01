ALTER TABLE "squad" ADD COLUMN "treasury_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "squad_debt_cents" bigint DEFAULT 0 NOT NULL;
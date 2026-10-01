ALTER TABLE "market" ADD COLUMN "seed_cents" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Existing markets: the seed already inside volume_cents is volume minus all
-- trade turnover. Recovered, not recomputed — the displayed number doesn't move.
UPDATE "market" m SET "seed_cents" = greatest(0, m."volume_cents" - coalesce((
  SELECT sum(t."amount_cents") FROM "trade" t WHERE t."market_id" = m."id"
), 0));
ALTER TABLE "blackjack_round" ADD COLUMN "sides" jsonb;
ALTER TABLE "blackjack_round" ADD COLUMN "doubled" boolean NOT NULL DEFAULT false;

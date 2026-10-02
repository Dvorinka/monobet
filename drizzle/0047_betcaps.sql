ALTER TABLE "casino_config" ADD COLUMN "game_max_bet_cents" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "trade_max_spend_cents" integer DEFAULT 500000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "game_bet_caps" jsonb;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "max_bet_cents" integer;

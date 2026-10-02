ALTER TABLE "casino_config" ADD COLUMN "game_max_lev" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "trade_max_lev" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "lev_fee_bps" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "game_lev_caps" jsonb;
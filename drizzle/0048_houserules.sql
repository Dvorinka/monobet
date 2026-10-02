ALTER TABLE "casino_config" ADD COLUMN "autobet_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "game_daily_limit_ms" integer DEFAULT 7200000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "game_idle_ms" integer DEFAULT 1800000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "game_fee_cents" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "trade_fee_cents" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "debt_rate_bps" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "referral_royalty_bps" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "referral_royalty_cap_cents" integer DEFAULT 200000 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "dice_pay_bps" integer DEFAULT 9200 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "limbo_pay_bps" integer DEFAULT 9600 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "limbo_min_x100" integer DEFAULT 110 NOT NULL;--> statement-breakpoint
ALTER TABLE "casino_config" ADD COLUMN "min_trade_cents" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_repay" boolean DEFAULT false NOT NULL;

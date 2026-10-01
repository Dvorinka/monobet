ALTER TABLE "user" ADD COLUMN "game_last_play_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "game_played_ms" bigint DEFAULT 0 NOT NULL;
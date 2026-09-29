ALTER TABLE "comment" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "comment_ban_until" timestamp with time zone;
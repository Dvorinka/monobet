ALTER TABLE "user" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "comments_banned" boolean DEFAULT false NOT NULL;
CREATE TABLE "reward_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_once_idx" ON "reward_claim" USING btree ("user_id","kind") WHERE "kind" LIKE 'bonus:%';
--> statement-breakpoint
CREATE INDEX "reward_user_idx" ON "reward_claim" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "image_url" text;
--> statement-breakpoint
CREATE TABLE "comment_vote" (
	"comment_id" uuid NOT NULL REFERENCES "comment"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"value" smallint NOT NULL,
	PRIMARY KEY("comment_id","user_id")
);

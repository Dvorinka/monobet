CREATE TABLE "challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"opponent_id" text NOT NULL,
	"claim" text NOT NULL,
	"stake_cents" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_id" text,
	"pending_winner_id" text,
	"pending_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_opponent_id_user_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_pending_winner_id_user_id_fk" FOREIGN KEY ("pending_winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_pending_by_id_user_id_fk" FOREIGN KEY ("pending_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_creator_idx" ON "challenge" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "challenge_opponent_idx" ON "challenge" USING btree ("opponent_id","created_at");
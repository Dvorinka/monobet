CREATE TABLE "season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "season_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rank" integer NOT NULL,
	"net_worth_cents" bigint NOT NULL,
	"reward_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "claim_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "season_result" ADD CONSTRAINT "season_result_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_result" ADD CONSTRAINT "season_result_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_index_key" ON "season" USING btree ("index");--> statement-breakpoint
CREATE INDEX "season_result_season_idx" ON "season_result" USING btree ("season_id","rank");
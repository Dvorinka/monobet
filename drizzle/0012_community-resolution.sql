CREATE TABLE "resolution_vote" (
	"market_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"vote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolution_vote_market_id_user_id_pk" PRIMARY KEY("market_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "proposed_outcome" text;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "proposed_by_id" text;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "resolution_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "recur_days" integer;--> statement-breakpoint
ALTER TABLE "resolution_vote" ADD CONSTRAINT "resolution_vote_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_vote" ADD CONSTRAINT "resolution_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market" ADD CONSTRAINT "market_proposed_by_id_user_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
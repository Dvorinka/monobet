CREATE TABLE "market_like" (
	"user_id" text NOT NULL,
	"market_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_like_user_id_market_id_pk" PRIMARY KEY("user_id","market_id")
);
--> statement-breakpoint
ALTER TABLE "market_like" ADD CONSTRAINT "market_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_like" ADD CONSTRAINT "market_like_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_like_market_idx" ON "market_like" USING btree ("market_id");
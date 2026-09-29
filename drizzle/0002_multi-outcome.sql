ALTER TABLE "market" ADD COLUMN "kind" text DEFAULT 'binary' NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "market" ADD CONSTRAINT "market_parent_id_market_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_parent_idx" ON "market" USING btree ("parent_id");
CREATE TABLE "category" (
	"name" text PRIMARY KEY NOT NULL,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"creator_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "category" ("name", "sort_index") VALUES
  ('Politics', 0), ('Geopolitics', 1), ('Sports', 2), ('Crypto', 3),
  ('Tech', 4), ('Culture', 5), ('Friends', 6), ('Other', 7);

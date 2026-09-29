CREATE TABLE "squad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "squad_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notif_resolve" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notif_closing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_id_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;
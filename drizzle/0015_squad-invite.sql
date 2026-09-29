CREATE TABLE "squad_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"inviter_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_invite_pair" UNIQUE("squad_id","invitee_id")
);
--> statement-breakpoint
ALTER TABLE "squad_invite" ADD CONSTRAINT "squad_invite_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_invite" ADD CONSTRAINT "squad_invite_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_invite" ADD CONSTRAINT "squad_invite_invitee_id_user_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_invite_invitee_idx" ON "squad_invite" USING btree ("invitee_id");
-- Hi-Lo rounds persist like timer rounds: face card dealt (and stake charged)
-- at start, direction + settle consume the row atomically.
CREATE TABLE "hilo_round" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "face_card" integer NOT NULL,
  "bet_cents" integer NOT NULL,
  "leverage" integer NOT NULL DEFAULT 1,
  "fee_cents" integer NOT NULL DEFAULT 0,
  "dir" text,
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "hilo_round_user_idx" ON "hilo_round" ("user_id", "created_at");

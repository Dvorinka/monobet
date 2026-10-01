ALTER TABLE "reward_claim" DROP CONSTRAINT "reward_claim_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "community_note" DROP CONSTRAINT "community_note_market_id_fkey";
--> statement-breakpoint
ALTER TABLE "community_note" DROP CONSTRAINT "community_note_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "wall_prayer" DROP CONSTRAINT "wall_prayer_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "blackjack_round" DROP CONSTRAINT "blackjack_round_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "jackpot_round" DROP CONSTRAINT "jackpot_round_winner_id_fkey";
--> statement-breakpoint
ALTER TABLE "hilo_round" DROP CONSTRAINT "hilo_round_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "timer_round" DROP CONSTRAINT "timer_round_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "comment_vote" DROP CONSTRAINT "comment_vote_comment_id_fkey";
--> statement-breakpoint
ALTER TABLE "comment_vote" DROP CONSTRAINT "comment_vote_user_id_fkey";
--> statement-breakpoint
DROP INDEX "wall_prayer_created_idx";--> statement-breakpoint
DROP INDEX "ledger_user_idx";--> statement-breakpoint
DROP INDEX "pp_market_idx";--> statement-breakpoint
DROP INDEX "trade_market_idx";--> statement-breakpoint
DROP INDEX "trade_user_idx";--> statement-breakpoint
DROP INDEX "reward_once_idx";--> statement-breakpoint
DROP INDEX "reward_user_idx";--> statement-breakpoint
DROP INDEX "season_index_key";--> statement-breakpoint
DROP INDEX "season_result_season_idx";--> statement-breakpoint
DROP INDEX "challenge_creator_idx";--> statement-breakpoint
DROP INDEX "challenge_opponent_idx";--> statement-breakpoint
DROP INDEX "market_category_idx";--> statement-breakpoint
DROP INDEX "market_parent_idx";--> statement-breakpoint
DROP INDEX "market_status_idx";--> statement-breakpoint
DROP INDEX "squad_invite_invitee_idx";--> statement-breakpoint
DROP INDEX "comment_market_idx";--> statement-breakpoint
DROP INDEX "community_note_market_idx";--> statement-breakpoint
DROP INDEX "blackjack_round_user_idx";--> statement-breakpoint
DROP INDEX "hilo_round_user_idx";--> statement-breakpoint
DROP INDEX "timer_round_user_idx";--> statement-breakpoint
DROP INDEX "market_like_market_idx";--> statement-breakpoint
DROP INDEX "position_user_idx";--> statement-breakpoint
ALTER TABLE "comment_vote" DROP CONSTRAINT "comment_vote_pkey";--> statement-breakpoint
ALTER TABLE "market" ALTER COLUMN "aliases" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "dealer_persona" ALTER COLUMN "avatar" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "casino_config" ALTER COLUMN "disabled_games" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "comment_vote" ADD CONSTRAINT "comment_vote_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id");--> statement-breakpoint
ALTER TABLE "reward_claim" ADD CONSTRAINT "reward_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_note" ADD CONSTRAINT "community_note_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_note" ADD CONSTRAINT "community_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_prayer" ADD CONSTRAINT "wall_prayer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_round" ADD CONSTRAINT "blackjack_round_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jackpot_round" ADD CONSTRAINT "jackpot_round_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hilo_round" ADD CONSTRAINT "hilo_round_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_round" ADD CONSTRAINT "timer_round_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_vote" ADD CONSTRAINT "comment_vote_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_vote" ADD CONSTRAINT "comment_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pp_market_idx" ON "price_point" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_market_idx" ON "trade" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_user_idx" ON "trade" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_once_idx" ON "reward_claim" USING btree ("user_id","kind") WHERE "reward_claim"."kind" like 'bonus:%';--> statement-breakpoint
CREATE INDEX "reward_user_idx" ON "reward_claim" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "season_index_key" ON "season" USING btree ("index");--> statement-breakpoint
CREATE INDEX "season_result_season_idx" ON "season_result" USING btree ("season_id","rank");--> statement-breakpoint
CREATE INDEX "challenge_creator_idx" ON "challenge" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "challenge_opponent_idx" ON "challenge" USING btree ("opponent_id","created_at");--> statement-breakpoint
CREATE INDEX "market_category_idx" ON "market" USING btree ("category");--> statement-breakpoint
CREATE INDEX "market_parent_idx" ON "market" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "market_status_idx" ON "market" USING btree ("status");--> statement-breakpoint
CREATE INDEX "squad_invite_invitee_idx" ON "squad_invite" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "comment_market_idx" ON "comment" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "community_note_market_idx" ON "community_note" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "blackjack_round_user_idx" ON "blackjack_round" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hilo_round_user_idx" ON "hilo_round" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "timer_round_user_idx" ON "timer_round" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "market_like_market_idx" ON "market_like" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "position_user_idx" ON "position" USING btree ("user_id");
-- Hidden grading jitter per round — the stop request's arrival can't be
-- aimed at an unknown offset, so scripted snipes land as ordinary errors.
ALTER TABLE "timer_round" ADD COLUMN "jitter_ms" integer NOT NULL DEFAULT 0;

-- Options move from independent binary LMSR books to one shared multinomial
-- book. A live option's coordinate is
--   coord_i = q_yes_i + Σ_{k≠i} q_no_k          (over live siblings)
-- and prices are softmax(coord) — so a group's probabilities always sum to 1
-- and trading one option reprices the rest. A NO share on option i is the
-- complement bundle: it lifts every sibling's coordinate.
--
-- Rewrite: keep each live option's implied probability where the old binary
-- price had it (normalized within its group), and keep outstanding NO bundles
-- counting toward sibling coordinates. Position rows are untouched.

WITH live_opts AS (
  SELECT m.id, m.parent_id, m.b,
         1 / (1 + exp((m.q_no::double precision - m.q_yes::double precision) / m.b)) AS p
  FROM market m
  WHERE m.kind = 'option' AND m.status = 'live'
),
norm AS (
  SELECT id, parent_id, b,
         COALESCE(p / NULLIF(SUM(p) OVER (PARTITION BY parent_id), 0), 0.001) AS pn
  FROM live_opts
),
outstanding AS (
  SELECT po.market_id AS id,
         SUM(po.no_shares::double precision) AS no_out
  FROM position po
  JOIN live_opts lo ON lo.id = po.market_id
  GROUP BY po.market_id
),
sib_no AS (
  SELECT n.id,
         COALESCE(SUM(o.no_out) OVER (PARTITION BY n.parent_id), 0)
           - COALESCE(o.no_out, 0) AS others_no
  FROM norm n
  LEFT JOIN outstanding o ON o.id = n.id
)
UPDATE market m
SET q_yes = (n.b * ln(GREATEST(n.pn, 0.0001)) - s.others_no)::numeric(24, 6),
    q_no  = COALESCE(o.no_out, 0)::numeric(24, 6)
FROM norm n
JOIN sib_no s ON s.id = n.id
LEFT JOIN outstanding o ON o.id = n.id
WHERE m.id = n.id;

-- Fresh point per live option at its normalized price, so every chart line
-- steps to the new book at once instead of drifting apart over next trades.
WITH live AS (
  SELECT id, parent_id, b,
         q_yes::double precision AS qy, q_no::double precision AS qn
  FROM market
  WHERE kind = 'option' AND status = 'live'
),
coords AS (
  SELECT id, parent_id, b,
         qy + COALESCE(SUM(qn) OVER (PARTITION BY parent_id), 0) - qn AS coord
  FROM live
),
z AS (
  SELECT id, parent_id, b, coord - MAX(coord) OVER (PARTITION BY parent_id) AS z
  FROM coords
),
sm AS (
  SELECT id, exp(z / b) / SUM(exp(z / b)) OVER (PARTITION BY parent_id) AS p
  FROM z
)
INSERT INTO price_point (market_id, yes_price)
SELECT id, p::numeric(7, 5) FROM sm;

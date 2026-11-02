-- Defend the Circle: the daily attendance sheet. One best run per voter per day.
CREATE TABLE IF NOT EXISTS scores (
  day        TEXT NOT NULL,       -- YYYYMMDD (UTC), the daily seed
  voter      TEXT NOT NULL,       -- salted daily IP hash, never the IP
  handle     TEXT NOT NULL,
  wave       INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  kills      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, voter)
);
CREATE INDEX IF NOT EXISTS scores_day ON scores (day, score DESC);

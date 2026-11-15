CREATE TABLE IF NOT EXISTS finance_operations (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  title VARCHAR(80) NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_operations_user_created_idx
  ON finance_operations (telegram_user_id, created_at DESC);

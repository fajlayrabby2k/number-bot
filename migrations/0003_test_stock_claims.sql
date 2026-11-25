CREATE TABLE IF NOT EXISTS test_stock_claims (
  country TEXT NOT NULL REFERENCES test_stock(country),
  serial INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  callback_id TEXT NOT NULL,
  PRIMARY KEY (country, serial)
);
CREATE INDEX IF NOT EXISTS test_stock_claims_callback ON test_stock_claims(callback_id);

CREATE TABLE IF NOT EXISTS service_test_stock (
  stock_key TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000)
);
CREATE TABLE IF NOT EXISTS service_test_stock_claims (
  stock_key TEXT NOT NULL REFERENCES service_test_stock(stock_key),
  serial INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  callback_id TEXT NOT NULL,
  PRIMARY KEY (stock_key, serial)
);
CREATE INDEX IF NOT EXISTS service_test_stock_claims_callback ON service_test_stock_claims(callback_id);

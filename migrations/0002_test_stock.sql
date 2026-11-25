CREATE TABLE IF NOT EXISTS test_stock (
  country TEXT PRIMARY KEY CHECK (country GLOB '[A-Z][A-Z]'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000)
);

INSERT INTO test_stock (country, quantity) VALUES ('BD', 50), ('IT', 50)
ON CONFLICT(country) DO NOTHING;

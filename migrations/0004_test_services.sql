CREATE TABLE IF NOT EXISTS test_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO test_services (id, name) VALUES
  ('fojlay', 'Fojlay Apps'),
  ('notes', 'Fojlay Notes'),
  ('desk', 'Fojlay Desk'),
  ('calendar', 'Fojlay Calendar')
ON CONFLICT(id) DO NOTHING;

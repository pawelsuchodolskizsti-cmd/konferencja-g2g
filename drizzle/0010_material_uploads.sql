CREATE TABLE material_uploads (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
 filename text NOT NULL,
 size integer NOT NULL CHECK (size > 0 AND size <= 20971520),
 sha256 text NOT NULL,
 chunks jsonb NOT NULL DEFAULT '[]'::jsonb,
 expires_at timestamptz NOT NULL,
 material_id uuid REFERENCES materials(id) ON DELETE CASCADE
);

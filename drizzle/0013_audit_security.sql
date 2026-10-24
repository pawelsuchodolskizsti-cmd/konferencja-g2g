ALTER TABLE organizational_deliveries ADD COLUMN content_encrypted text;
--> statement-breakpoint
ALTER TABLE material_uploads DROP CONSTRAINT material_uploads_size_check;
--> statement-breakpoint
ALTER TABLE material_uploads ALTER COLUMN size TYPE bigint;
--> statement-breakpoint
ALTER TABLE material_uploads ADD CONSTRAINT material_uploads_positive_size CHECK (size > 0 AND size <= 9007199254740991);
--> statement-breakpoint
ALTER TABLE material_uploads ADD COLUMN replaces_id uuid REFERENCES materials(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE material_uploads ADD COLUMN expected_content_hash text;
--> statement-breakpoint
CREATE TABLE material_upload_parts (
  upload_id uuid NOT NULL REFERENCES material_uploads(id) ON DELETE CASCADE,
  part integer NOT NULL CHECK (part >= 0),
  encrypted_content text NOT NULL,
  PRIMARY KEY (upload_id, part)
);

-- A full snapshot per event grew with the world's size: a four-floor world
-- filled tens of gigabytes. The journal keeps each event with the receipt it
-- landed, and one row holds the current snapshot.
ALTER TABLE world_events ADD COLUMN receipt TEXT;
--> statement-breakpoint
UPDATE world_events SET receipt = (
  SELECT json_extract(agent.value, '$.receipt')
  FROM json_each(world_events.snapshot, '$.agents') AS agent
  WHERE json_extract(agent.value, '$.agent') = json_extract(world_events.event, '$.agent')
)
WHERE json_extract(event, '$._tag') = 'ReceiptLanded';
--> statement-breakpoint
CREATE TABLE world_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  snapshot TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO world_snapshot (id, snapshot)
SELECT 0, snapshot FROM world_events ORDER BY sequence DESC LIMIT 1;
--> statement-breakpoint
ALTER TABLE world_events DROP COLUMN snapshot;

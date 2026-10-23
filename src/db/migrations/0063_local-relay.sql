CREATE TABLE local_relay_events (
 id text PRIMARY KEY NOT NULL, pubkey text NOT NULL, kind integer NOT NULL,
 created_at integer NOT NULL, coordinate text, expires_at integer,
 stored_at integer NOT NULL, bytes integer NOT NULL, event text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX local_relay_coordinate ON local_relay_events(coordinate);
--> statement-breakpoint
CREATE INDEX local_relay_time ON local_relay_events(created_at DESC,id);
--> statement-breakpoint
CREATE INDEX local_relay_author_time ON local_relay_events(pubkey,created_at DESC,id);
--> statement-breakpoint
CREATE INDEX local_relay_kind_time ON local_relay_events(kind,created_at DESC,id);
--> statement-breakpoint
CREATE INDEX local_relay_author_kind_time ON local_relay_events(pubkey,kind,created_at DESC,id);
--> statement-breakpoint
CREATE INDEX local_relay_eviction ON local_relay_events(stored_at,id);
--> statement-breakpoint
CREATE TABLE local_relay_tags (
 event_id text NOT NULL REFERENCES local_relay_events(id) ON DELETE CASCADE,
 name text NOT NULL,value text NOT NULL,PRIMARY KEY(event_id,name,value)
);
--> statement-breakpoint
CREATE INDEX local_relay_tag_lookup ON local_relay_tags(name,value,event_id);
--> statement-breakpoint
CREATE TABLE local_relay_stats (id integer PRIMARY KEY CHECK(id=1),events integer NOT NULL,bytes integer NOT NULL);
--> statement-breakpoint
INSERT INTO local_relay_stats VALUES(1,0,0);
--> statement-breakpoint
CREATE TRIGGER local_relay_insert AFTER INSERT ON local_relay_events BEGIN
 UPDATE local_relay_stats SET events=events+1,bytes=bytes+NEW.bytes WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER local_relay_delete AFTER DELETE ON local_relay_events BEGIN
 UPDATE local_relay_stats SET events=events-1,bytes=bytes-OLD.bytes WHERE id=1;
END;

-- Initial opt-in schema. Applying this does not migrate or switch Fluid hunts.
CREATE TABLE hunts (
    id uuid PRIMARY KEY,
    guild_id text NOT NULL,
    name text NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
    configuration jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(configuration) = 'object'),
    document jsonb NOT NULL DEFAULT '{"nodes": {}}'
        CHECK (jsonb_typeof(document) = 'object' AND document ? 'nodes'
            AND jsonb_typeof(document->'nodes') = 'object'),
    source_provenance jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, guild_id)
);

CREATE INDEX hunts_by_guild ON hunts (guild_id);

-- This separate pointer permits archived hunts without an implicit "latest" hunt.
CREATE TABLE active_hunts (
    guild_id text PRIMARY KEY,
    hunt_id uuid NOT NULL,
    FOREIGN KEY (hunt_id, guild_id) REFERENCES hunts(id, guild_id)
);

-- Never reuse an entity ID, including after deletion or a worker restart.
CREATE TABLE node_identities (
    hunt_id uuid NOT NULL REFERENCES hunts(id),
    node_id uuid NOT NULL,
    PRIMARY KEY (hunt_id, node_id)
);

CREATE TABLE command_receipts (
    hunt_id uuid NOT NULL REFERENCES hunts(id),
    command_id uuid NOT NULL,
    command jsonb NOT NULL,
    committed_revision bigint NOT NULL CHECK (committed_revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (hunt_id, command_id)
);

-- One coalescing desired-state refresh per integration per hunt.
CREATE TABLE integration_jobs (
    hunt_id uuid NOT NULL REFERENCES hunts(id),
    target text NOT NULL CHECK (target IN ('discord', 'google')),
    requested_revision bigint NOT NULL CHECK (requested_revision > 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    PRIMARY KEY (hunt_id, target)
);

CREATE INDEX integration_jobs_ready ON integration_jobs (available_at);

-- Lifecycle tombstones and distinct logs must not disappear behind a newer state.
CREATE TABLE integration_events (
    hunt_id uuid NOT NULL,
    command_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    revision bigint NOT NULL CHECK (revision > 0),
    payload jsonb NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    delivered_at timestamptz,
    PRIMARY KEY (hunt_id, command_id, ordinal),
    FOREIGN KEY (hunt_id, command_id)
        REFERENCES command_receipts(hunt_id, command_id)
);

CREATE INDEX integration_events_ready ON integration_events (available_at)
    WHERE delivered_at IS NULL;

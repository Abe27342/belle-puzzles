-- Initial opt-in schema. Applying this does not migrate or switch Fluid hunts.
CREATE TABLE hunts (
    id uuid PRIMARY KEY,
    guild_id text NOT NULL,
    name text NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
    configuration jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(configuration) = 'object'),
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

CREATE TABLE hunt_nodes (
    hunt_id uuid NOT NULL REFERENCES hunts(id),
    id uuid NOT NULL,
    type text NOT NULL CHECK (type IN ('round', 'puzzle')),
    name text NOT NULL,
    url text NOT NULL,
    parent_id uuid,
    -- Only rounds may be parents; this value participates in the foreign key below referencing hunt_nodes.
    parent_type text GENERATED ALWAYS AS ('round'::text) STORED,
    position bigint NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
    answer text,
    status text,
    last_status_update bigint
        CHECK (last_status_update BETWEEN 0 AND 9007199254740991),
    sheet_id text,
    discord_channel_id text,
    discord_role_id text,
    discord_index_channel_id text,
    PRIMARY KEY (hunt_id, id),
    UNIQUE (hunt_id, id, type),
    FOREIGN KEY (hunt_id, parent_id, parent_type)
        REFERENCES hunt_nodes(hunt_id, id, type),
    CONSTRAINT puzzle_requires_parent CHECK (type = 'round' OR parent_id IS NOT NULL),
    CONSTRAINT node_cannot_parent_itself CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT puzzle_properties_only CHECK (
        type = 'puzzle' OR (
            answer IS NULL AND status IS NULL AND last_status_update IS NULL
            AND sheet_id IS NULL
        )
    ),
    CONSTRAINT status_has_timestamp CHECK (
        (status IS NULL) = (last_status_update IS NULL)
    ),
    CONSTRAINT complete_discord_association CHECK (
        (
            discord_channel_id IS NULL AND discord_role_id IS NULL
            AND discord_index_channel_id IS NULL
        ) OR (
            discord_channel_id IS NOT NULL AND discord_role_id IS NOT NULL
            AND (
                (type = 'round' AND discord_index_channel_id IS NOT NULL)
                OR (type = 'puzzle' AND discord_index_channel_id IS NULL)
            )
        )
    )
);

-- Separate root/non-root indexes also enforce uniqueness when parent_id is NULL.
CREATE UNIQUE INDEX hunt_nodes_child_positions ON hunt_nodes (hunt_id, parent_id, position)
    WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX hunt_nodes_root_positions ON hunt_nodes (hunt_id, position)
    WHERE parent_id IS NULL;

-- Bounded synchronization tracking, not an identity reservation or integration outbox.
-- Empty ID lists still record revision coverage (including metadata-only changes).
CREATE TABLE hunt_changes (
    hunt_id uuid NOT NULL REFERENCES hunts(id),
    revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    node_ids uuid[] NOT NULL,
    PRIMARY KEY (hunt_id, revision)
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

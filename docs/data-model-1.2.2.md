# AbyssLog 1.2.2 data model

Schema v7 adds concurrent character preparation and shared Abyssal encounters to
the normalized schema-v6 run records.

## Encounters and ship entries

`encounters` represents one Abyssal instance. It owns a stable encounter UUID,
shared start and duration bounds, tier, weather, and Abyssal system.

`runs` remains the aggregate root for one character's participation. Each run
keeps its character, hull, fit, outcome, inventories, appraisal history, tags,
and killmail references, and links to exactly one encounter. Solo encounters
have one linked run. Group encounters have multiple linked runs.

Loot and costs are never copied between participants. Inventory differences
record which character collected loot, spent filaments, or consumed ammunition,
boosters, charges, and drones. Encounter totals combine the current appraisal
from every participant.

## Concurrent recovery

`tracking_drafts` stores one bounded version-1 preparation per character:

- tier and weather;
- pre-run cargo and drone text;
- notes and tags.

`active_run_state` remains keyed by character. Version-3 recovery snapshots add
the encounter UUID, allowing multiple unfinished participant runs to recover
independently after restart.

Likely group participants are suggested from overlapping Abyssal entry
observations. Their encounter UUIDs are unified only after explicit confirmation.
Group encounters accept at most three frigates or two destroyers of one shared
ship class. Cruiser encounters remain one-to-one.

Manual group entry sends all validated participant records in one request. The
repository creates one encounter UUID and saves every participant in one
transaction, preventing partial manual encounters.

## Migration and interchange

Startup accepts a structurally valid schema-v6 database, writes and verifies a
standalone pre-migration backup, and migrates to schema v7 in one transaction.
Every historical run receives a one-to-one solo encounter. Existing active
snapshots are upgraded without changing their captured run data.

Full restore accepts schema-v7 backups and verified schema-v6 backups from
AbyssLog 1.2.0 or 1.2.1. History CSV format version 2 is the AbyssLog 1.2.2
format and includes both encounter and run UUIDs. Older CSV formats are rejected.

# Database schema (D1)

Source of truth: [`backend/src/db/schema.ts`](../backend/src/db/schema.ts) (Drizzle). Migrations in `backend/migrations/` are generated from it with `pnpm --filter @monkeytype/backend db:generate`, never written by hand.

Rule of thumb: a field gets its own column when a query filters, sorts or aggregates on it, or SQL updates it in place (counters). Data that is always read and written whole (config, personal bests, tags) is a JSON text column.

| Table | Upstream (Mongo) | Purpose |
| --- | --- | --- |
| `users` | `users` | One row per account, keyed by Firebase uid. |
| `results` | `results` | Test history. |
| `leaderboard_entries` | `leaderboards.*` + `users.lbPersonalBests` | Best result per user per leaderboard. |
| `configs` | `configs` | Synced settings, one row per user. |
| `presets` | `presets` | Saved settings presets. |
| `announcements` | `psa` | Site wide banners (upstream "PSAs"). |
| `quote_ratings` | `quote-rating` | Rating totals per quote. |
| `public_stats` | `public` | Site wide counters (single row, `id = 1`). |

All per-user tables cascade on user delete.

## users

- Columns: `uid` (PK), `name` (unique, case insensitive), `email`, `added_at`, flags (`banned`, `lb_opt_out`, `verified`, `needs_to_change_name`), `last_name_change`, counters (`xp`, `started_tests`, `completed_tests`, `time_typing` in seconds).
- JSON: `personal_bests`, `tags` (each with its own PBs), `custom_themes`, `result_filter_presets`, `streak`, `test_activity` (tests per day per year), `lb_memory`, `favorite_quotes`, `quote_ratings` (this user's own ratings), `profile_details`, `last_result_hashes` (duplicate result check).
- Dropped from upstream: discord, inbox, inventory/badges, premium, ips, name history, ape keys, bananas, `lbPersonalBests` (replaced by `leaderboard_entries`).

## results

- Columns: `id` (24 hex chars, time sortable, same shape as upstream ObjectIds), `uid`, `timestamp`, `mode`, `mode2`, `language`, `wpm`, `acc`, `is_pb`.
- `data` (JSON): the rest of the result (`rawWpm`, `charStats`, `consistency`, `tags`, ...), default values omitted like upstream.
- `chart_data`, `key_spacing_stats`, `key_duration_stats` (JSON): only read when one result is opened, so the history list skips them.
- Index `(uid, timestamp)`: history, last result, result spacing check.

## leaderboard_entries

- PK `(mode, mode2, language, uid)`. Stores `wpm`, `acc`, `raw`, `consistency`, `timestamp`.
- Written only when a result is a PB in a leaderboard mode (time 15/60, no lazy mode) and beats the stored entry, so it costs at most one write per PB.
- Read live: `ORDER BY wpm DESC, acc DESC, timestamp ASC` with the index `leaderboard_rank`, joined to `users` to hide banned/opted out users and users under `minTimeTyping` (2h, skipped in dev). Rank = position in that order.
- Upstream rebuilt leaderboards hourly with a job (cron). Not needed here: no cron trigger.
- Known ceiling: the total `count` and a user's rank scan the leaderboard (D1 bills rows read). Fine up to ~10k entries per leaderboard; past that, cache the count or materialize ranks with a Cron Trigger.

## Free tier budget (100k rows written/day)

Saving a result writes: 1 result row (+1 index), 1 user row, 1 `public_stats` row, and on a leaderboard PB 1 entry (+1 index). About 4 to 6 row writes, so roughly 15k+ results/day fit in the free tier.

## R2

Binding `BLOBS` (bucket `beavertype-blobs`) is wired but unused, reserved for keystroke logs.

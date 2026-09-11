INSERT INTO sessions
  (id, version, created_at, cwd, team_id, participant_id, parent_session, seed_length,
   agent_preset, incarnation, revision)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET
  version = excluded.version,
  created_at = excluded.created_at,
  cwd = excluded.cwd,
  team_id = excluded.team_id,
  participant_id = excluded.participant_id,
  parent_session = excluded.parent_session,
  seed_length = excluded.seed_length,
  agent_preset = excluded.agent_preset;

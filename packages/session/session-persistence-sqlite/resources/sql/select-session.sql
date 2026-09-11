SELECT id, version, created_at, cwd, team_id, participant_id, parent_session, seed_length,
       agent_preset, incarnation, revision
FROM sessions
WHERE id = ?;

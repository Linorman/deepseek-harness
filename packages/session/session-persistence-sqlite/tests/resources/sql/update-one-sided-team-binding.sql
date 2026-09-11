UPDATE sessions
SET team_id = 'team-without-participant', participant_id = NULL
WHERE id = ?;

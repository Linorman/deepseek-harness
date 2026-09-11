# @clocky/clocky-team-channel-admission

English | [中文](README.zh.md)

`@clocky/clocky-team-channel-admission` provides `ctx.teamChannelAdmission`. It discovers durable channel invitations after startup, expires unacknowledged endpoints through source-owned Hub proofs, and lets dispatch Consumers wait for actual channel activation. It never acknowledges on behalf of an Agent or treats an installed adapter as endpoint consent.

## Admission and recovery

The Hub opens every channel as `pending`, with one frozen invitation per manifest member. Each invitation retains its role, channel-manifest visibility, required/optional choice, deadline, endpoint expectation, revision and manifest fingerprint. Every required endpoint must durably acknowledge before the Hub appends `active`. The immutable manifest does not shrink when an optional endpoint expires.

`waitUntilActive({ channelId, signal })` observes current channel cursors and returns only an active snapshot. Terminal admission or cancellation rejects the wait. TeamRun creation/workflow compilation and scheduler wake/review dispatch use it before sending protocol work. The service holds no Hub lock while waiting and aborts its waits on disposal. A repeated or rewound channel watch cursor fails the wait with `TEAM_CHANNEL_CURSOR_CONFLICT` instead of retrying the same continuation.

Recovery scans bounded Team pages and a FIFO of channel identities. `scanIntervalMs` defaults to `100`, `teamPageSize` to `64`, and `maxChannelsPerPass` to `128`. Each pass uses `Date.now()` in its exact source-owned expiry proof. `runOnce()` permits an explicit recovery pass and joins an already running pass. The Hub owns `channelInvitationTimeoutMs`, default `30000`, and freezes deadlines during creation. Restart preserves those deadlines and acknowledgements.

A missing required endpoint expires the channel with `TEAM_CHANNEL_REQUIRED_INVITATION_EXPIRED`. An optional expiry continues only if the retained adapter explicitly allows removing that member; otherwise the channel fails with `TEAM_CHANNEL_OPTIONAL_REMOVAL_UNSUPPORTED`. Direct v4 permits removal while at least two invitation members remain. Closing stops admission before ending pending invitations and writing the terminal record.

## Endpoint Consumers

The Agent Client receives exact invitations over local or WebSocket v6 Links, verifies its current binding and supported manifest, then acknowledges through the Link's private activation proof. Invitation acknowledgement creates neither model input nor an Envelope receipt. Existing claim, Session flush and receipt operations still own message delivery.

`createPrincipalChannelAdmission(ctx, call)` from `/principal` supplies a runtime-only Host/SDK capability for TeamRun creation. It accepts the supported direct-v3 human/coordinator manifest with directed-v1 policy and uses the current authenticated principal to bind the complete acknowledgement payload to a human proof. Call cancellation revokes that proof. TeamRun checks a callback actually persisted consent; failure enters its normal creation cleanup. System-owned humans are confirmed independently by the actual TeamRun result Consumer.

`resolvePrincipalChannelText` preserves an initiating consult request's explicit `taskId`; responses inherit the retained request's task and reject conflicting routing. Keyed retries recover the retained task when omitted, while a changed task reaches the Hub's idempotency-conflict check.

## Model Experience

### Channel invitation admission

#### What the model sees

No invitation prompt or synthetic message. A protocol message reaches a model only after `channel activation` and ordinary durable delivery.

#### Token effect

Invitation confirmation consumes no model tokens.

#### KV Cache effect

Admission changes no request prefix.

## Known Limitations and Deferred Work

- **Placement remains separate** — missing Agent residency is not created by this Consumer; unavailable required endpoints reach their durable deadline.
- **Product protocol selection remains explicit** — default TeamRun and its principal endpoint Consumer use direct v3. Generic Host/SDK invitation operations and default direct-v4/remote text-tool cutover remain separate Consumer integration work.
- **Human display is downstream** — endpoint consent proves supported protocol admission, not a browser display acknowledgement or a durable human final inbox receipt.

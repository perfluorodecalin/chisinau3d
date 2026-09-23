# Multiplayer architecture decision

## Goals

Keep the entire game and offline city on GitHub Pages. Provide reliable casual
driving with friends across NATs with minimal operations and credential handling.
Use one small Cloudflare Worker with one Durable Object per invite room. Deploy
on Workers Free initially; quotas then stop service rather than produce paid
overages. Paid accounts require an explicit cost decision: limits in application
code are not an account spending cap.

## Transport and scope

- Browser opens one WSS connection to the room service. No Trystero, Nostr,
  WebRTC, TURN, signaling network, or credential issuer in the new path.
- Eight participants per room, including spectators. Render up to seven remote
  cars with existing shared geometry and smoothing. Local physics remains local;
  the service owns membership and validates messages, but does not simulate cars.
- Each room is identified by a cryptographically generated UUID. Possession is
  permission to join. Use URL fragments for new invite links to avoid sending the
  invite in ordinary Pages HTTP requests/referrers. Support existing query links
  as input. Joining always requires an explicit user action.
- One room ID maps to one Durable Object. A live room has one world version;
  reject a mismatched build explicitly rather than silently splitting the room.
- This is an invite-room design. A future global public space needs admission
  controls and spatial interest subscriptions/shards. A global all-to-all room
  is deliberately not claimed by this implementation.

## Bounded snapshot exchange

The client maintains its latest local pose. At a target 10 Hz while driving
(2 Hz while spectating), it sends a small tick request containing a monotonically
increasing request sequence and its current pose. The server stores the validated
latest pose and returns one complete snapshot of the room to that caller only.

Only one request may be outstanding per client; a delayed response reduces the
rate instead of accumulating traffic. Fresh local poses replace unsent poses.
The snapshot acknowledges the request and contains server-assigned player IDs,
membership and sanitized latest poses. A receiver infers joins/leaves by comparing
rosters. This gives at most one request and one response in flight per connection,
avoids broadcasting a malicious sender's messages to everyone, and bounds server
work to eight peers per accepted request. TCP loss/large RTT can reduce update
rate: acceptable for this casual ghost-car mode, not a competitive racing design.

No world files or physics are sent. No database writes per tick. Use hibernatable
WebSockets and compact per-connection attachments to restore ID, world, latest
pose, sequence, rate state and last-seen time after hibernation. Keep each attachment
under Cloudflare's limit. No periodic server timer. Prune stale sockets during
join/tick handling so frozen tabs cannot occupy slots indefinitely.

## Admission and validation

- Require the configured Pages Origin and an exact room route; reject other
  routes, origins, methods, malformed IDs and invalid world IDs before DO lookup.
  Origin is browser isolation, not authentication against non-browser programs.
- Apply an edge upgrade rate limit and an enforced eight-player capacity. Room
  slots include connections still handshaking; impose bounded handshake expiry.
- Server assigns identity. Ignore/reject supplied identity, unknown message
  types and fields, non-text/oversized messages, non-finite or out-of-range pose
  fields, wrong versions, stale sequences, and excessive request rates. Keep
  validation shared with the browser. Close repeat/flood offenders.
- Each socket can change only its own pose and receive only its own room. No
  arbitrary forwarding, outbound fetch, user HTML, file upload, persistent profile,
  or generic messaging API. Error messages must be bounded and safe to display.
- Do not log invite URLs or raw messages. Disable request observability by default.
  No application secrets or administrator endpoints exposed to the browser.
- Private invites can be shared by recipients and do not establish real identity.
  Bots can still consume free quotas and cause an outage. This is not anti-cheat
  or a public-service DDoS guarantee; managed admission can be added if needed.

## Client lifecycle and deployment

Expose connecting, connected/waiting, reconnecting, full/version mismatch and
disabled states truthfully. Connected means an accepted server welcome. Bounded
exponential reconnect with jitter, finite attempts and an explicit retry path;
never retry terminal full/version/protocol rejection forever. Response timeout
reconnects; ignore stale socket callbacks. Leaving cancels all timers and clears
remote cars. Ensure inactive state reaches the server even when no peers exist.

Keep a single public WSS endpoint in static configuration. An empty endpoint
leaves single-player operational and clearly says multiplayer is not configured.
Deployment needs a Cloudflare account and one Worker/SQLite DO namespace, plus
the Pages endpoint setting. No API keys in game assets; Cloudflare CLI login is
deployment authorization only. Do not silently deploy or upgrade a billing plan.

## Acceptance

Test with the actual local Workers runtime and real WebSockets when available:
two clients exchange poses, late join sees current poses, leave/stale pruning,
room and world isolation, full capacity, malformed/flood traffic, client identity
spoofing, hibernation restoration, bounded requests under delayed responses,
disconnect/reconnect, and leave during connect. Also run the repository checks,
offline build/verification, and UI checks. Report separately any unverified live
deployment or rendered graphics behavior. Documentation must state that merging
client code alone does not deploy the room service.

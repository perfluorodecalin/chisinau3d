# Room relay

The Pages site is static. This Worker provides invite-room WebSockets through a SQLite Durable Object; publishing Pages does not deploy the Worker.

1. Create a Cloudflare account and install/authenticate Wrangler (`npx wrangler login`). The free plan has quotas and stops serving traffic at its limits. Moving to a paid plan is a separate cost decision; application limits are not a spending cap.
2. Set `PAGES_ORIGIN` in `wrangler.toml` to the exact origin that hosts the game, without a trailing slash. If using a custom Pages domain, use that origin. The edge accepts only matching browser Origin headers and `/rooms/<uuid>?world=<sha256>` upgrades. Origin checks are browser isolation, not authentication against scripts.
3. In this directory, run `npx wrangler deploy`. Confirm the Worker URL, then set `MULTIPLAYER_ENDPOINT` in `../dist/multiplayer-config.js` to its `wss://` origin with no path. Publish the updated static site separately. Do not include Cloudflare API tokens in client files.

For local development, run `npx wrangler dev` from `relay/` and set the endpoint to `ws://localhost:8787` in the local site. The browser's Origin must match `PAGES_ORIGIN`; use a local `wrangler.toml` override or `--var PAGES_ORIGIN:http://localhost:5173` for Vite. Run `npm run dev` from the repository root and join a room from two tabs. Worker changes need their own deployment, independent of Pages.

Rooms allow eight sockets and prune idle connections after 30 seconds during join or tick handling. Client requests target 10 Hz while driving and 2 Hz while spectating; at most one request is pending. The relay is not authoritative for physics or anti-cheat. Invites grant access and can be forwarded. There is no persistent room database, admin endpoint, generic messaging, or log of raw room links; observability is disabled by default. Edge upgrade limiting uses the account's configured native rate-limit binding.

`npm run test:multiplayer:runtime` uses Miniflare/workerd with real WebSocket upgrades and local Durable Objects. It requires no Cloudflare account.

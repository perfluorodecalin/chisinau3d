# Chișinău driving game

## Start here
- Read `DEVELOPING.md` and `README.md` before changing the game.
- The application source is authored directly in `dist/`. This is intentional: do not delete or regenerate that directory with a bundler.
- Use `npm ci`, `npm run dev`, and `npm test`. Node.js 22.12+ is suitable for the pinned Vite version.
- Keep the existing Three.js version synchronized between the npm development dependency and `dist/vendor/`.

## Preserve the world
- `dist/data/` contains the saved OSM and terrain snapshots required at runtime. Keep them available offline; do not replace them with live Overpass calls.
- Never bulk-query OSM just to run, test or develop the game. The user specifically requested conservative server use.
- Preserve attribution and distinguish mapped facts from estimated heights, façades, bridges, lamps and corrected road widths.
- Road corrections belong in the game model, not uploaded to OpenStreetMap without a separate explicit request.
- Keep visible roads, collision/spawn rules, sidewalks, crossings, lamps and bridge widths consistent.
- Preserve shared-node bridge connectivity and ground/deck separation.

## Verification
- Run the existing quality checks for physics, road geometry, terrain or lighting changes. For small UI edits, use focused checks.
- Test graphics and audio in a capable browser when available. Do not report visual, audible or FPS verification from syntax checks or mocks.
- Audio is opt-in, must remain mutable while driving, and should suspend in background tabs.
- Favor spatial indexing, bounded light counts and reusable geometry/audio over per-frame citywide work.

## Hosting
- `.openai/hosting.json` identifies the existing private Sites deployment. Do not create a replacement Site or change its audience as part of routine development.
- If Sites skills are available in the environment, follow them for this checkout and any requested publishing.
- Local development requires no Sites credentials. GitHub pushes alone do not update the existing live Site.
- Never commit authentication tokens, local dependency directories or temporary deployment archives.

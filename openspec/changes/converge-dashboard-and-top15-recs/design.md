# Design: Dashboard, Mega-Menu & Top-15 Studio Convergence

## Architecture Decisions

1. **Non-Overlapping Mega-Menu Featured Preview**:
   - All Mega-Menu preview graphics (`apps/web/public/assets/previews/*.svg`) are generated as pure geometric/architectural SVG illustrations without embedded text.
   - `.tt-mm__panel-featured-title` uses `position: static !important; background: #080b1a !important` below the 16:9 image container so caption text can never collide with SVG content.
2. **Bidirectional Hash Routing & `⌘K` Command Palette**:
   - `switchWorkspaceView(ws)` synchronizes with `location.hash` (`#overview`, `#playground`, `#research`, `#copilot`, `#activity`, `#usage`, `#keys`, `#settings`) and listens to `hashchange` for zero-reload deep-linking.
   - `⌘K` / `Ctrl+K` opens `#cmdPaletteModal` to filter and execute view transitions or API key / MCP actions.
3. **Dynamic User Avatar & Initials Derivation**:
   - `.tt-avatar-circle` (`#navAvatarCircle`) renders the user's OAuth/profile `avatarUrl` image when available, falls back to 2-letter initials computed from `userName` or `userEmail`, and displays a monochrome user silhouette SVG when signed out.

# Specification: Dashboard, Mega-Menu & Top-15 Studio Convergence

## ADDED Requirements

### Requirement: Consolidated Mega-Menu with Non-Overlapping Visual Previews

The top navbar across `/`, `/blog/*`, and `/app/` SHALL expose a single two-column `Explore & Guides` Mega-Menu with text-free SVG preview graphics and a non-overlapping `position: static` caption bar, paired with the primary CTA and dynamic `.tt-avatar-circle`.

#### Scenario: Hovering or focusing a Mega-Menu item

- **WHEN** a user opens `Explore & Guides` on desktop (`>=721px`)
- **THEN** the panel renders a 2-column item list alongside a featured preview card whose `.tt-mm__panel-featured-title` caption is positioned statically below the preview SVG with zero text overlap.

### Requirement: Emoji-Free Monochrome SVG Iconography & Focused Single-View Dashboard

Both `/` and `/app/` SHALL use crisp monochrome 16×16 SVG line icons rather than emojis, and `/app/` SHALL display one focused view at a time (`Overview` by default) with bidirectional URL hash routing (`#overview`, `#playground`, `#research`, `#copilot`, `#activity`, `#usage`, `#keys`, `#settings`) and a `⌘K` Command Palette.

#### Scenario: Deep-linking or switching views in `/app/`

- **WHEN** a user navigates to `/app/#playground` or selects `Go to Playground` from the `⌘K` Command Palette
- **THEN** `#viewTitle` updates to `Playground` and only the `#playground` section is visible.

### Requirement: Dynamic Account Avatar & Profile Persistence

The top-right `.tt-avatar-circle` SHALL render the authenticated user's `avatarUrl` image if present, or derive 2-letter initials from `userName` / `userEmail`, or show a user silhouette icon when logged out, backed by `POST /api/auth/profile` and social OAuth callbacks.

#### Scenario: Updating user profile or signing in via Google/GitHub

- **WHEN** a user signs in or updates their display name to `"Brian Zalewski"` via `POST /api/auth/profile`
- **THEN** `.tt-avatar-circle` immediately displays `"BZ"` (or the user's `avatarUrl` image).

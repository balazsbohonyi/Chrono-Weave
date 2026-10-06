# Relationship overlay and persistent expansion clusters

Status: Implemented. Both actions open the connections overlay with progress feedback. The focus person stays alone above alternating related-card rows. Canvas curves and the floating launcher are removed. Relationship cards offer biography navigation that returns to the same explanation.

## Purpose

Preserve expansion clusters on the timeline when configured, and present relationships in a modal card diagram shared by Expand Timeline and Map Relationships.

The canvas retains its chronological horizontal positioning. The relationship diagram uses a separate layout independent of historical dates and sidebar positions.

## Configuration

Add configuration to `src/constants.ts`:

- `KEEP_DISCOVERY_CLUSTERS = true`: boolean on/off switch for retaining expansion clusters.

`DISCOVERY_FIGURES_COUNT` remains the requested number of new figures per expansion. It does not cap the overlay's total connections. Repeated expansions and mapping may produce more connections than this value.

## Expansion clusters

### Retention on

- Preserve every expansion cluster until a successful timeline rebuild replaces the timeline.
- Each expansion clusters its source and newly discovered figures only, matching existing membership behavior. Existing related figures appear in the overlay but are not pulled into the canvas cluster.
- Closing the relationship overlay, opening or closing detail dialogs, interacting with the canvas, and mapping relationships must not release retained placement.
- Preserve the positions of members of previously retained clusters when further expansions occur. A figure shared by multiple clusters appears once and keeps its original retained position.
- Place new members near their source where collision-free space permits. Historical dates still determine horizontal positions.
- Ordinary figures outside retained clusters may move to accommodate new expansions and prevent overlaps.
- Persist cluster membership and member placement with the saved timeline. Restore these placements after a page refresh, with the relationship overlay initially closed.
- Reset saved clusters when a successful rebuild replaces the timeline. A failed rebuild leaves the existing timeline and clusters intact.

### Retention off

- Expansion still creates a temporary cluster, matching current behavior.
- Keep that temporary cluster while the relationship overlay is open, including through relationship and biography navigation.
- Release the temporary cluster when the relationship overlay closes, allowing the normal canvas layout to resume.
- Ignore retained-placement metadata when loading a timeline with retention disabled.

Keep layout retention separate from active relationship state and transient discovery highlighting. Clearing relationship UI must not accidentally clear retained placement.

## Shared relationship overlay

- Both actions open the full-screen overlay immediately, with the existing progress popover while results are pending. Match the figure action container's white 60% background and 24px backdrop blur.
- Use dark overlay titles and status text, blue action labels, and a blue close icon.
- Show the focus card and progress loader while the action runs. Load portraits without delaying results for image availability.
- Do not draw relationship curves on the canvas or the card overlay. Remove the floating canvas launcher and dependence on sidebar card coordinates and scrolling.
- Show all verified related figures, including categories hidden by canvas filters. Leave those filters intact.
- Preserve existing relationship assessment, caches, and mapping's automatic expansion fallback. When that fallback expands the timeline, apply the same expansion-cluster rules.
- Preserve the canvas pan and zoom while the overlay is open and when it closes. Layout changes from an expansion may change figure placement, but do not move the camera.
- Keep the underlying canvas, sidebar, and controls unavailable for interaction while the modal is active.

## Cards and connections

- Every card shows a portrait when available, full name, dates, and occupation, using the existing compact focus-card appearance.
- Allow names to wrap. Keep biographies and relationship descriptions in the existing detail dialogs.
- Distinguish the source with a subtle blue outline. Cards have no individual close buttons.
- Sort related cards alphabetically by name, consistent with the sidebar. Preserve this order across layouts and returns from dialogs.
- Relationship cards represent verified connections without connecting curves.
- Keep the focus person alone in the first row, centered, regardless of connection count.
- Overlay card clicks open details; canvas pan and zoom stay unchanged during modal navigation.

## Layout and overflow

- On medium desktop screens, place related cards below the source in alternating three-card and two-card rows.
- On wide desktop screens, use alternating four-card and three-card rows when enough connections are available.
- Center each related-card row, including the final incomplete row. Fill the final row if that avoids an extra singleton. Tablets use two-card rows.
- On narrow screens, place the source above a single column of related cards.
- Keep cards readable and use vertical scrolling when the diagram cannot fit. Include all verified connections; do not limit results to fit the screen.
- Keep the floating X button fixed at the overlay's top-right corner, independent of content scrolling. Hide the scrollbar while keeping wheel, touch, and keyboard scrolling available.
- Preserve diagram arrangement and scroll position when returning from a detail dialog.

## Animation

- When related results first become visible, fade cards in one by one in their alphabetical order.
- Use approximately 200 ms per fade and a 70 ms stagger between cards.
- Only related overlay cards use the staggered appearance animation.
- Run this animation once for a result set. Returning from a biography or relationship dialog restores the diagram immediately.
- If results complete while a detail dialog is covering the diagram, defer their first appearance animation until the diagram becomes visible.
- Respect reduced-motion preferences by showing cards without the staggered animation.

## Detail navigation and dismissal

- Clicking the source opens the existing biography dialog.
- Clicking a related card opens the existing relationship dialog for that source-target pair.
- While a detail dialog is open, hide the entire card diagram and its floating close button. Use a single visible modal backdrop rather than accumulating blur layers. Biography and relationship detail backdrops use the same white 60% background and 24px blur as the connections overlay, including biographies opened directly from the canvas.
- Closing a relationship detail dialog restores the diagram and its scroll position. Both figure cards in the relationship dialog reveal biography icons on hover or keyboard focus. Position these controls over the cards so they do not add height. Closing a biography opened from either icon restores the same source-target explanation, its body scroll position, and focus on the biography icon.
- The relationship overlay closes only via its floating X or Escape. Empty-backdrop clicks do nothing.
- Biography and relationship detail dialogs retain their current dismissal methods: X, Escape, or clicking their backdrop.
- Escape dismisses only the active view. From a detail dialog it returns to the diagram; a subsequent Escape closes the relationship overlay.
- Keep keyboard focus within the active modal. Restore focus to the card when a detail dialog closes, and to the invoking control where it remains available when the relationship overlay closes.

## Loading, cancellation, and empty states

- Keep the overlay close button usable while the progress loader is visible.
- Closing the relationship overlay cancels its pending action and prevents late results from reopening it or adding unseen figures.
- Opening a detail dialog does not count as closing the relationship overlay.
- Display no-results messages inside the overlay with the source card still visible, after applying the existing mapping fallback where applicable.
- On a failure, retain the source card, show a clear error, and offer Retry for the failed action.
- The user can open the source biography from these states or close the overlay.

## Initial implementation findings

These findings describe the implementation before this plan was completed:

- `App.tsx` held transient discovery-source and discovered-member IDs alongside relationship state.
- Clearing relationship UI also cleared the discovery IDs, changing layout order and moving figures.
- The canvas drew relationship paths and a floating source card using coordinates reported by the sidebar. That rendering and coordinate reporting have been removed.
- `RelationshipPopover.tsx` already supported biography and source-target relationship modes, along with Escape and backdrop dismissal.
- Saved timeline data included figures and configuration without cluster membership or placement. Cluster metadata is now persisted separately.

## Implementation outline

1. Add the retention switch and responsive related-card row layout.
2. Introduce retained cluster membership and placement independent of relationship visibility. Validate saved metadata against the current timeline before using it.
3. Update the canvas layout to reserve retained members' rows, place new cluster members near their source, and place ordinary figures without collisions. Capture and save retained placements after the layout resolves.
4. Restore cluster metadata on load and clear it on successful timeline rebuild. Keep the retention-off path temporary.
5. Create one relationship-overlay component for loading, results, empty, and error states, opened immediately by mapping or expansion. Render the source alone above alternating rows of connected cards.
6. Remove the canvas relationship SVG and source card, plus the sidebar coordinate reporting used only by that presentation.
7. Wire existing biography and relationship handlers to overlay cards, with active-modal dismissal, focus handling, and diagram restoration.
8. Preserve action cancellation and stale-request guards, including when a mapping action falls back to expansion.

## Acceptance checks

- With retention on, expanding and closing the overlay leaves the source and discovered members at the same canvas positions.
- Further expansions preserve earlier clusters, including shared members, and do not duplicate figures.
- Previously existing related figures are included in the overlay without becoming cluster members merely because they are related.
- Refresh restores retained positions; successful rebuild clears them; failed rebuild preserves them.
- With retention off, the temporary cluster remains through overlay/detail/biography navigation and releases only when the relationship overlay closes.
- Map Relationships uses the same overlay and does not change cluster placement unless its existing fallback actually performs an expansion.
- Both actions show the overlay and progress loader immediately, followed by one staggered appearance of verified related cards. There are no canvas curves or floating launcher.
- Verify layouts for zero, one, five, six, and many related figures; long names; missing portraits; desktop, tablet, and narrow screens.
- All related cards remain accessible through vertical scrolling, there are no overlay curves, and the overlay X remains visible.
- Canvas category filters do not suppress overlay cards and remain intact after dismissal.
- Source clicks open biography; target clicks open the correct relationship; detail dismissal restores the same diagram and scroll position without replaying the animation.
- Backdrop clicks leave the relationship overlay open but dismiss detail dialogs. Escape closes exactly one active view.
- Cancellation prevents late data additions and reopening. Empty and error states stay visible, and Retry reruns the failed action.
- Opening, using, and closing either overlay preserves canvas pan and zoom.
- Run relevant automated tests for placement retention, saved metadata, and request lifecycle; run typecheck and production build; visually verify alternating card rows, progress feedback, and relationship-to-biography navigation.

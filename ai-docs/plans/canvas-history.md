# Canvas history

Store twenty previous canvases plus the current canvas in localStorage. Only successfully generated canvases replace the current canvas. Failed or cancelled builds leave it intact.

History excludes the active canvas and stays ordered newest-created first. Reopening swaps the chosen canvas with the outgoing canvas, saving completed changes without duplication or refreshing creation time. Creating another canvas evicts the oldest history entry when necessary.

Restore figures, events, discoveries and their placements, cached relationships and biographies, timeline/gallery mode, each mode's zoom and pan, category filters, search and sidebar selection, sidebar tab and scroll position, and sidebar/legend visibility. Close dialogs and cancel pending operations on switching. Provider settings and theme remain global.

The canvas has short thick horizontal lines stacked at its left edge. The launcher has vertical ticks arranged horizontally below its header at the top right. Both follow the demo's marker expansion and nearby-marker animation, with a single smoothly moving popover and immediate content changes between entries. The launcher popover follows the hovered tick while staying inside the viewport.

Popovers show the original prompt on one line with an ellipsis when needed, prompting mode, historical duration and chosen or inferred year range, separate positive figure/event counts, creation date, and unique verified connection count. Counts include discovered entries and ignore viewing filters. Clicking or tapping restores immediately; keyboard focus previews, arrow keys navigate, and Enter activates. Reduced-motion preferences disable transitions.

Migrate the previous single-canvas save and its cached AI results on first load. Persist the active canvas automatically and on page hiding. Scope AI caches to each canvas so pending operations and overlapping figure IDs cannot affect another canvas. A failed storage write preserves the previous durable save and reports the failure.

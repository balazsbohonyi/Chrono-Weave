# Light and dark themes

The light theme preserves the existing appearance. Theme changes cover the entire
application, including timeline labels, bars, category legend, markers, connectors,
selection backgrounds, tooltips, dialogs, Markdown, loading states, and toasts.
Layout, typography, blur, opacity, and interaction behavior remain the same.

## Agreed behavior

- Start light on first visit, independent of the device preference.
- Save the user's choice under `chrono_theme` and restore it before rendering.
- Place the theme button immediately before Settings: moon in light mode, sun in
  dark mode. Its tooltip and accessible label describe the destination theme.
- Switch colors immediately while retaining existing interaction animations.
- Use a cool slate dark canvas, slate translucent panels, and blue accents.
- Keep category hue identities and tune fill brightness and year text for contrast.
  Legend swatches use the same category tokens as timeline bars.
- Use a pale slate bar with dark year text for search focus in dark mode, retaining
  the existing pulse. Preserve the original black search bar in light mode.
- Switching themes preserves timeline data, viewport, filters, search, and selection.

## Implementation

1. Extract all authored colors into semantic RGB channel variables in
   `src/styles/tokens.css`. Retain existing Tailwind opacity modifiers and shadow
   geometry; consume tokens in Tailwind, custom CSS, and category mappings.
2. Verify the light-only refactor against the existing rendering.
3. Add a complete dark palette using the same tokens, plus theme state and the
   toggle. Keep the theme stylesheet and saved-preference bootstrap in the HTML
   head so the saved theme applies before React renders.
4. Verify both palettes, persistence, keyboard operation, timeline interactions,
   and dialogs. Run tests, TypeScript checking, and the production build.

## Light parity evidence

The light-only refactor matched all 17 measured style properties across 481
elements in a timeline fixture containing every category and a short event.
The Settings view also matched across all 510 elements. Measurements included
colors, borders, shadows, typography, opacity, filters, and backdrop blur.
Existing light category fills and black/white year text also have regression checks.

The final light theme also matched the same baseline after excluding the new
theme button. Browser checks verified saved dark mode after reload, keyboard
focus and Enter activation, destination labels, search-focus colors, preserved
search/filter/viewport state, Settings, and biography Markdown styling.
All 113 tests passed, as did `npm run typecheck` and `npm run build`.

## Dark theme contrast refinements

Relationship overlay, relationship dialog, and sidebar cards now share a lighter
slate surface. Dedicated tokens distinguish the dialog header, connector circle,
green and blue card borders, blue summary, hover actions, and selected sidebar tabs.
The Leaders & Baddies fill is slightly darker to distinguish it from Events.

Overlay, relationship dialog, and Settings close buttons share one visible style
in both themes. Other new role tokens retain the original light theme values.
Contrast checks cover text on translucent cards, summary text, action icons,
selected tabs, card borders, category bars, and close controls. Browser checks
covered both themes and the overlay, dialog, sidebar, and Settings surfaces.
All 114 tests passed, as did `npm run typecheck` and `npm run build`.

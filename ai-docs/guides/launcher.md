# Weave launcher

The launcher (`src/components/WeaveLauncherOverlay.tsx` plus `src/components/launcher/`) is a full-screen dialog: glass strategy cards over a canvas of drifting threads on a paper ground. It was ported from the chosen prototype, V1 Glass candidate, which lives untracked in `prototypes/launcher/candidates/`. The props and the `App.tsx` call site are unchanged from the earlier illustrated launcher.

## Pieces

- **`strategies.ts`**: all launcher copy and the time-span scale.
  - Copy: strategies, rotating headline words, quick-pick presets, eras, build phase titles.
  - Scale: `yearToPos` and `posToYear` use piecewise-linear knots that compress antiquity and widen recent centuries. `eraOf` and `parseYear` sit beside them, tested in `tests/launcherScale.test.ts`.
- **`ThreadField.ts`**: the Canvas2D strands, in viewport pixels. It reads its colours from the launcher root's tokens; call `refreshColors()` after a theme change and `destroy()` on unmount. Its API:
  - `attract` pulls strands toward a hovered card.
  - `converge` gathers them around a rect.
  - `setHighlight` brightens the era-band window.
  - `setTimeline` and `setTimelineProgress` pull everything into a line during a build.
  - `setSpeed` speeds up the Surprise ticker.
  - `pulse` sends out a ripple.
- **`LauncherHero`**: the headline with its rotating word. Hovering a card holds that card's word.
- **`StrategyGrid`**: the six glass cards, with tilt, parallax and hover tracing. Its handle (`leave`, `rectOf`, `enter`, `reveal`, `focus`, `panes`) is the grid's side of the card ⇄ stage morph.
- **`PromptStage`**: the mode tabs and the stage card (the overlay adds the Back button above them). It holds the textarea with marquee examples, or the year fields with presets and `EraBand`, plus `BuildProgress`.
- **`SurpriseCard`**: the Surprise Me scrim card, showing the ticker, the suggestion, the broaden notice or the errors.
- **`PaperGround`**: the fibre texture and the two seeded torn sheets.
- **`launcher.css`**: every launcher style. The tokens (`--bg`, `--ink`, `--accent`, `--glass`, …) are scoped to `.lx-root` and switch with the app's `data-theme`.

## Behaviour that matters

- **Card ⇄ stage morph.** The overlay sets `pending` and commits the views; a layout effect then measures and flies a ghost element appended inside `.lx-root`, so the ghost keeps the scoped tokens.
  - Both views stay mounted, swapped with `hidden` and `inert`.
  - `is-in` on the stage and on `.lx-reveal` is toggled imperatively, so those elements keep static `className`s.
- **Animation.** It uses `framer-motion/dom` `animate`, pinned to 11.18.2, the engine the prototype loaded from the CDN.
  - motion commits its final inline styles a frame after a promise resolves, so the code clears `transform`, `filter` and `opacity` in the next animation frame.
  - Never give a React `style` prop to an element that motion animates.
  - Glass panes are dimmed one by one, never through a wrapper, because an opacity or filter on an ancestor cuts `backdrop-filter` off from the threads.
- **Era band clicks** set the span to the clicked era's years, also through the window lying over the era (a tap without movement); dragging still pans.
- **Existing time spans.** Before weaving a strict time span, the overlay asks App's `findTimeSpanCanvas` (`isTimeSpanCanvas` in `src/utils/canvasHistory.ts`). If the current canvas or one in history covers exactly those years, the stage shows a notice with **Open it** instead of weaving. Era names come from `src/utils/eras.ts`, which also titles time-span canvases (`formatCanvasPrompt`).
- **Build progress** follows the app's `phase` prop. A success unmounts the launcher. A failure stops the form fade, restores the form and shows `getUserErrorMessage`.
- **Surprise ticker.** It runs until `onSurprise` settles, then decelerates. An `EmptyCanvasError` from weaving a suggestion asks for a broader topic.
- **Escape** goes only through `useModalFocus`, in this order:
  1. Collapse the Surprise card.
  2. During a build, close the launcher, which cancels the build.
  3. On the stage, go back to the grid.
  4. Otherwise close.
- **Reduced motion** follows `prefers-reduced-motion`: there is no morph, the field draws static frames and the example chips scroll.

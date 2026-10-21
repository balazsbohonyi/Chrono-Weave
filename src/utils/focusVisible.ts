// Whether a focused element should show its focus ring: focus the keyboard moved there, or on a text field. Focus put there by the page itself
// after a mouse click (a dialog's initial focus, focus handed back to the control that opened it) does not match, so a tooltip that opens on
// focus can leave it to hover. A browser without `:focus-visible` throws on the selector: every focus counts then, as it did before.
export function isFocusVisible(target: EventTarget | null): boolean {
  const element = target as { matches?: (selector: string) => boolean } | null;
  if (typeof element?.matches !== 'function') return false;
  try { return element.matches(':focus-visible'); } catch { return true; }
}

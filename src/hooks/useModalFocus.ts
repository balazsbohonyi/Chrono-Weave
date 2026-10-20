import { RefObject, useLayoutEffect } from 'react';

// initialFocus 'container' lands on the dialog itself instead of its first control, for dialogs whose first
// control reacts to focus (the launcher's canvas history opens its popover on focus).
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void, externalFocusSelector?: string,
  initialFocus: 'first-control' | 'container' = 'first-control') {
  // Release the previous dialog's trap before the next dialog's layout effects
  // focus its controls. Passive cleanup happens too late for this handoff.
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const external = () => externalFocusSelector ? [...document.querySelectorAll<HTMLElement>(externalFocusSelector)] : [];
    const contains = (node: Node | null) => dialog.contains(node) || external().some(element => element.contains(node));
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(selector), ...external().flatMap(element => [...element.querySelectorAll<HTMLElement>(selector)])]
      .filter(element => !element.hasAttribute('disabled') && !element.closest('[inert]') && element.tabIndex !== -1 && element.getClientRects().length > 0)
      .sort((first, second) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const focusDialog = () => (focusable().find(element => dialog.contains(element)) ?? dialog).focus({ preventScroll: true });
    if (!contains(document.activeElement)) {
      if (initialFocus === 'container') dialog.focus({ preventScroll: true });
      else focusDialog();
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0] ?? dialog;
        const last = elements.at(-1) ?? dialog;
        if (event.shiftKey && (document.activeElement === first || !contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!contains(event.target as Node)) focusDialog();
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', containFocus);
      queueMicrotask(() => {
        if (previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      });
    };
  }, [active, ref, onClose, externalFocusSelector, initialFocus]);
}

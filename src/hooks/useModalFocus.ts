import { RefObject, useEffect } from 'react';

export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void, externalFocusSelector?: string) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const external = () => externalFocusSelector ? [...document.querySelectorAll<HTMLElement>(externalFocusSelector)] : [];
    const contains = (node: Node | null) => dialog.contains(node) || external().some(element => element.contains(node));
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(selector), ...external().flatMap(element => [...element.querySelectorAll<HTMLElement>(selector)])]
      .filter(element => !element.hasAttribute('disabled') && !element.closest('[inert]') && element.tabIndex !== -1 && element.getClientRects().length > 0)
      .sort((first, second) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    if (!contains(document.activeElement)) (focusable().find(element => dialog.contains(element)) ?? dialog).focus({ preventScroll: true });
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
      if (!contains(event.target as Node)) (focusable()[0] ?? dialog).focus({ preventScroll: true });
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
  }, [active, ref, onClose, externalFocusSelector]);
}

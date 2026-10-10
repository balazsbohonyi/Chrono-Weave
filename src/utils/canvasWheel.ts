// Controls sit beside the canvas in the DOM. Listen above both so pinch and
// wheel gestures use the canvas camera instead of the browser's page zoom.
export function listenForCanvasWheel(container: HTMLElement, onWheel: (event: WheelEvent) => void, disabled: boolean): () => void {
  const scope = container.closest('[data-canvas-wheel-scope]') ?? container;
  const handleWheel = (event: WheelEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !scope.contains(target)) return;
    if (!container.contains(target) && !target.closest('[data-canvas-controls], [data-canvas-history], .canvas-floating-button')) return;
    if (!event.ctrlKey && !event.metaKey && target.closest('[data-canvas-scroll]')) return;
    // A modal freezes the camera, but zooming over its header/history must
    // still not resize the whole app. Ordinary modal scrolling is untouched.
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    if (!disabled) onWheel(event);
  };
  container.ownerDocument.addEventListener('wheel', handleWheel, { passive: false, capture: true });
  return () => container.ownerDocument.removeEventListener('wheel', handleWheel, true);
}

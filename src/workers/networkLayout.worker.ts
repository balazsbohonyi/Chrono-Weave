import { createLayoutHost } from '../services/networkLayoutHost';
import type { LayoutCommand, LayoutFrame } from '../services/remoteNetworkLayout';

// The Six Degrees explorer's layout, off the main thread: d3-force ticks and the seating of a big round of new people (hundreds of
// milliseconds at a few hundred people) happen here, and the explorer only paints the frames this sends back (RemoteNetworkLayout).
// The project compiles with the DOM library, so the worker's own global is described here rather than with the webworker library.
const scope = self as unknown as {
  postMessage(message: LayoutFrame, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<LayoutCommand>) => void) | null;
};
const handle = createLayoutHost((frame, transfer) => scope.postMessage(frame, transfer));
scope.onmessage = event => handle(event.data);

import { NetworkLayout } from './connectionNetworkLayout';
import type { LayoutCommand, LayoutFrame } from './remoteNetworkLayout';

// The worker side of RemoteNetworkLayout: a NetworkLayout driven by commands, answering every tick (and settle) with a frame.
// Kept apart from the worker's entry file so the protocol can be run in a test without a worker.
export function createLayoutHost(post: (frame: LayoutFrame, transfer: Transferable[]) => void, layout = new NetworkLayout()) {
  let graphChanged = true;
  let sentGuides: unknown[] = [], sentPinned = '';

  const frame = (seq: number) => {
    const ids = [...layout.nodes.keys()], positions = new Float64Array(ids.length * 2);
    ids.forEach((id, at) => { const p = layout.position(id); positions[2 * at] = p?.x ?? NaN; positions[2 * at + 1] = p?.y ?? NaN; });
    const message: LayoutFrame = { seq, active: layout.active, positions, zones: layout.freeZones };
    if (graphChanged) { message.ids = ids; graphChanged = false; }
    // Guides keep their identity in the layout until they change, so only a change is sent.
    const guides = [layout.rings, layout.columns, layout.categories, layout.corridor];
    if (guides.some((guide, index) => guide !== sentGuides[index])) {
      message.guides = { rings: layout.rings, columns: layout.columns, categories: layout.categories, corridor: layout.corridor };
      sentGuides = guides;
    }
    const pinned = [...layout.pinned].sort().join('\n');
    if (pinned !== sentPinned) { message.pinned = [...layout.pinned]; sentPinned = pinned; }
    post(message, [positions.buffer]);
  };

  return (command: LayoutCommand) => {
    switch (command.type) {
      case 'bounds': layout.setBounds(command.start, command.end); break;
      case 'size': layout.setSize(command.width, command.height); break;
      case 'mode': layout.setMode(command.mode); break;
      case 'graph': layout.setGraph(command.inputs, command.links); graphChanged = true; break;
      case 'dragStart': layout.dragStart(command.id); break;
      case 'dragTo': layout.dragTo(command.id, command.x, command.y); break;
      case 'dragEnd': layout.dragEnd(command.id); break;
      case 'unpin': layout.unpin(command.id); break;
      case 'unpinAll': layout.unpinAll(); break;
      case 'tick': layout.step(); frame(command.seq); break;
      case 'settle': layout.settle(command.max); frame(command.seq); break;
    }
  };
}

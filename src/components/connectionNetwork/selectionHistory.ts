import type { NetworkSelection } from '../../services/connectionNetworkView';
import type { DetailTab, InspectorTab } from './inspectorRows';

// Where the inspector's Back button goes. Opening something from a list in the inspector (a contact from a person's list) pushes the
// step it came from, with what the reader had done there; Back pops it. Selecting on the graph, or clearing, starts over, so then Back
// goes to the main list (the tab, search and scroll of which were never touched).
export interface DetailMemory { tab: DetailTab; top: number }
export interface Step { selection: NetworkSelection; detail?: DetailMemory }

// More than a person and a contact never happens (nothing in a contact leads on), but the stack is bounded anyway.
const MAX_STEPS = 16;
export const pushStep = (history: readonly Step[], step: Step): Step[] => [...history, step].slice(-MAX_STEPS);

// What Back says: the person it returns to, or the list the inspector was last on.
export function backLabel(history: readonly Step[], listTab: InspectorTab, nameOf: (id: string) => string): string {
  const previous = history[history.length - 1]?.selection;
  if (previous?.person) return `← ${nameOf(previous.person)}`;
  if (previous?.edge) return '← Contact';
  return listTab === 'people' ? '← People' : '← Contacts';
}

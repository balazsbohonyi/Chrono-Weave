import { CONNECTION_REVEAL_MAX_MS, CONNECTION_REVEAL_PER_PERSON_MS } from '../constants';

// How long each part of the Six Degrees reveal takes. A person is given time in proportion to how far the
// camera has to travel to them, and every person is held for a moment once reached, so the evidence of
// each link can be read. Only a chain too long for the overall cap is sped up, and then evenly. The cap is
// `CONNECTION_REVEAL_MAX_MS` or, for a long chain, the per-person allowance times the number of people.
export const REVEAL_INTRO_MS = 600, REVEAL_HOLD_MS = 250, REVEAL_APPROACH_MS = 700, REVEAL_SETTLE_MS = 1000;
// When a reveal opens on the first person (the stage fading in around them) that person gets this much extra on top of the
// usual pause: the stage is still fading in during the first part of it, and this is where the story starts. It is not
// part of the plan's budget, so a long chain runs this much over its cap.
export const REVEAL_OPENING_HOLD_MS = 1500;

const TRAVEL_BASE_MS = 700, TRAVEL_MS_PER_PX = 0.4, TRAVEL_MIN_MS = 800, TRAVEL_MAX_MS = 2400;
const DWELL_MS = 550;
// A chain squeezed by the cap never goes faster than this per hop, or lingers shorter than this per person.
const FLOOR_TRAVEL_MS = 250, FLOOR_DWELL_MS = 150;

export interface RevealPlan {
  // Camera flight to each next person, one per link.
  travelMs: number[];
  // The pause on each person once reached: the first one, and then one after every link.
  dwellMs: number[];
  totalMs: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// `distances` are the on-screen distances (in pixels at the zoom the camera settles on) between consecutive people.
export function planReveal(distances: readonly number[], maxTotalMs = CONNECTION_REVEAL_MAX_MS): RevealPlan {
  const natural = distances.map(distance => clamp(TRAVEL_BASE_MS + TRAVEL_MS_PER_PX * (Number.isFinite(distance) ? Math.max(0, distance) : 0), TRAVEL_MIN_MS, TRAVEL_MAX_MS));
  const people = distances.length + 1;
  const fixed = REVEAL_INTRO_MS + REVEAL_HOLD_MS + REVEAL_APPROACH_MS + REVEAL_SETTLE_MS;
  const wanted = natural.reduce((sum, ms) => sum + ms, 0) + people * DWELL_MS;
  const budget = Math.max(0, Math.max(maxTotalMs, fixed + people * CONNECTION_REVEAL_PER_PERSON_MS) - fixed);
  const factor = wanted > budget ? budget / wanted : 1;
  const travelMs = natural.map(ms => Math.max(FLOOR_TRAVEL_MS, ms * factor));
  const dwell = Math.max(FLOOR_DWELL_MS, DWELL_MS * factor);
  const dwellMs = Array.from({ length: people }, () => dwell);
  return { travelMs, dwellMs, totalMs: fixed + travelMs.reduce((sum, ms) => sum + ms, 0) + dwell * people };
}

import data from "./naya-roster.json" with { type: "json" };

// Naya's agent roster (blueprint v3): who does what, with which input and output, and which person
// answers for it. claude-worker reads the same JSON to route subtasks and to pick each agent's
// system prompt; the code is the task's Hermes assignee.

export interface RosterAgent {
  code: string;
  /** Blueprint code, e.g. "2B"; "UM" for the generalist. */
  label: string;
  name: string;
  pillar: string;
  input: string;
  output: string;
  /** The human role that reviews this agent's work (blueprint's PIC column). */
  pic: string;
  /** False when the agent needs tools claude-worker does not have yet. */
  available: boolean;
  reason?: string;
  prompt: string;
}

export const NAYA_ROSTER: readonly RosterAgent[] = data.agents;
export const ROSTER_FALLBACK: string = data.fallback;

export function rosterAgent(code: string | null | undefined): RosterAgent | undefined {
  return code ? NAYA_ROSTER.find((agent) => agent.code === code) : undefined;
}

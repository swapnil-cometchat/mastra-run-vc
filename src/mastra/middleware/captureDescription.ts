// Middleware to mark when a company description has likely been captured so we avoid more qualification.
import type { QualState } from './questionLimiter';

function ensureQual(memory: any): QualState {
  if (!memory.__qual) {
    memory.__qual = { asked: 0, descriptionCaptured: false } as QualState;
  }
  return memory.__qual as QualState;
}

// Naive heuristic: user message containing first-person company description patterns.
const DESCRIPTION_REGEX = /\b(we|our|my\s+company|our\s+product|we\s+are\s+building|we\s+build)\b/i;

export function captureDescription() {
  return {
    name: 'capture-description',
    async onUserMessage(input: string, context: any) {
      const memory = (context?.memory ?? (context.memory = {}));
      const state = ensureQual(memory);
      if (!state.descriptionCaptured && DESCRIPTION_REGEX.test(input)) {
        state.descriptionCaptured = true;
      }
      return { input };
    },
  };
}

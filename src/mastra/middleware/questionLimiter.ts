// Middleware to cap qualification / intake questions to <=3 short prompts overall
// Heuristic: count '?' emitted while in an intake phase and trim extras.

export interface QualState {
  asked: number;
  descriptionCaptured: boolean;
}

const QUAL_LIMIT = 3;

function ensureQual(memory: any): QualState {
  if (!memory.__qual) {
    memory.__qual = { asked: 0, descriptionCaptured: false } as QualState;
  }
  return memory.__qual as QualState;
}

export function questionLimiter() {
  return {
    name: 'question-limiter',
    // onAfterModel gives us assistant draft; we can trim questions beyond limit
    async onAfterModel(output: string, context: any) {
      const memory = (context?.memory ?? (context.memory = {}));
      const state = ensureQual(memory);

      // Count new question marks in this output
      const qMarks = (output.match(/\?/g) || []).length;
      if (qMarks === 0) return { output };

      const remaining = Math.max(0, QUAL_LIMIT - state.asked);
      if (remaining <= 0) {
        // Strip all further questions; keep first non-question sentence.
        const sentences = output.split(/(?<=[.!?])\s+/);
        const kept: string[] = [];
        for (const s of sentences) {
          if (s.includes('?')) continue; // drop questions entirely
          kept.push(s);
        }
        return { output: kept.join(' ') };
      }

      // If this batch exceeds the remaining allowance, trim
      if (qMarks > remaining) {
        let allowed = remaining;
        const tokens = output.split(/(\?|\n)/);
        const rebuilt: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (t === '?') {
            if (allowed > 0) {
              rebuilt.push(t);
              allowed--;
            } else {
              // remove trailing part of the question: skip
              continue;
            }
          } else {
            rebuilt.push(t);
          }
        }
        state.asked = QUAL_LIMIT; // we've now exhausted
        return { output: rebuilt.join('').replace(/\n{2,}/g, '\n') };
      }

      state.asked += qMarks;
      return { output };
    },
  };
}

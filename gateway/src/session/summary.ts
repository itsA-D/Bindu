import type { ModelMessage, LanguageModel } from "ai"
import { generateText } from "ai"
import type { MessageWithParts } from "./message"
import { toModelMessages } from "./message"

/**
 * Summarize a run of older messages into a compact paragraph so they can be
 * replaced by a single synthetic system turn during compaction.
 *
 * The summary captures: what the user has asked, which agents have been
 * called, what artifacts came back (key facts only — not full payloads),
 * and the current state of the plan.
 *
 * We intentionally keep this single-pass and cheap. OpenCode's equivalent
 * (`session/summary.ts` + `session/compaction.ts`) does a more sophisticated
 * multi-step reduction; for Phase 1, a one-shot summary is sufficient.
 */

const SUMMARY_SYSTEM = `You are a session compaction summarizer for the Bindu Gateway.
You receive a list of messages representing recent multi-agent work: user
questions, planner reasoning, agent tool calls, and agent responses.

Your job: produce ONE concise paragraph (≤ 400 words) that captures ALL of:
1. What the user has asked (the running goal)
2. Which remote agents have been called and for what sub-task
3. The KEY FACTS returned by each agent — not full quotes, just the load-bearing details the planner will need to answer remaining questions
4. The current state of the plan: what's done, what remains

DO NOT:
- Invent facts that aren't in the messages
- Include agent DIDs, URLs, tokens, or any auth material
- Format as bullets; use flowing prose so it reads as context

Output the paragraph directly, no preamble.`

export interface SummarizeInput {
  model: LanguageModel
  /** Messages that will be collapsed into the summary. */
  messagesToCompact: MessageWithParts[]
  abortSignal?: AbortSignal
}

export async function summarize(input: SummarizeInput): Promise<string> {
  const history: ModelMessage[] = toModelMessages(input.messagesToCompact)
  const result = await generateText({
    model: input.model,
    system: SUMMARY_SYSTEM,
    messages: [
      ...history,
      {
        role: "user",
        content:
          "Summarize the above session history into one compact paragraph per the rules in your system message.",
      },
    ],
    abortSignal: input.abortSignal,
  })
  return result.text.trim()
}

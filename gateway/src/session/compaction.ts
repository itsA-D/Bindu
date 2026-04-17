import { Context, Effect, Layer } from "effect"
import type { LanguageModel } from "ai"
import { Service as DBService } from "../db"
import { Service as ProviderService } from "../provider"
import { Service as SessionService } from "./index"
import { DEFAULT_THRESHOLD, estimateHistoryTokens, isOverflow, type OverflowThreshold } from "./overflow"
import { summarize } from "./summary"
import type { SessionID } from "./schema"
import type { MessageWithParts } from "./message"

/**
 * Session compaction service.
 *
 * Strategy (Phase 1 — simple, effective, replaceable later):
 *   1. Estimate total tokens in history.
 *   2. If over the trigger fraction of the usable context window:
 *      a. Split history at `keepTail` turns from the end.
 *      b. Summarize the head into one paragraph via a cheap model call.
 *      c. Store the summary on the session row.
 *      d. Mark all compacted messages with `compacted=true` so history()
 *         calls skip them.
 *   3. On next `prompt()`, the session loader prepends the summary as a
 *      synthetic system message, then loads only non-compacted turns.
 *
 * Rationale for summary-based rather than truncation: for multi-agent
 * plans, the load-bearing facts are scattered across tool results. Simple
 * truncation loses them. A paragraph is much cheaper than raw history and
 * preserves the planner's ability to reference past calls.
 */

export interface CompactInput {
  sessionID: SessionID
  model: string // "provider/modelId" — the summarizer model (usually same as planner)
  abortSignal?: AbortSignal
  /** Minimum recent turns to preserve verbatim. */
  keepTail?: number
  threshold?: OverflowThreshold
}

export interface CompactOutcome {
  compacted: boolean
  tokensBefore: number
  tokensAfter?: number
  summary?: string
  messagesCompactedCount?: number
}

export interface Interface {
  readonly compactIfNeeded: (input: CompactInput) => Effect.Effect<CompactOutcome, Error>
  readonly forceCompact: (input: CompactInput) => Effect.Effect<CompactOutcome, Error>
}

export class Service extends Context.Service<Service, Interface>()("@bindu/SessionCompaction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* DBService
    const sessions = yield* SessionService
    const provider = yield* ProviderService

    function splitHead(
      history: MessageWithParts[],
      keepTail: number,
    ): { head: MessageWithParts[]; tail: MessageWithParts[] } {
      if (history.length <= keepTail) return { head: [], tail: history }
      return {
        head: history.slice(0, history.length - keepTail),
        tail: history.slice(history.length - keepTail),
      }
    }

    async function runCompaction(
      history: MessageWithParts[],
      llm: LanguageModel,
      keepTail: number,
      sessionID: SessionID,
      abortSignal?: AbortSignal,
    ): Promise<CompactOutcome> {
      const { head, tail } = splitHead(history, keepTail)
      const before = estimateHistoryTokens(history)
      if (head.length === 0) {
        return { compacted: false, tokensBefore: before }
      }

      const summary = await summarize({
        model: llm,
        messagesToCompact: head,
        abortSignal,
      })

      // Mark the head messages as compacted
      const client = db.client()
      const headIds = head
        .map((m) => (m.info as any).id as string | undefined)
        .filter((x): x is string => !!x)

      // Fetch actual row IDs — message.info.id is our internal MessageID,
      // but message rows use row.id. For Phase 1 the internal id equals
      // the row id (we generate it client-side and round-trip via metadata.info).
      // That's a simplification worth documenting; Phase 2 could reconcile.
      const idsSQL = headIds
      if (idsSQL.length > 0) {
        const { error } = await client
          .from("gateway_messages")
          .update({ compacted: true })
          .eq("session_id", sessionID)
          .in("id", idsSQL)
        if (error) {
          throw new Error(`compaction: failed to mark compacted: ${error.message}`)
        }
      }

      // Store summary on session row
      const { error: sessErr } = await client
        .from("gateway_sessions")
        .update({
          compaction_summary: summary,
          compaction_at: new Date().toISOString(),
        })
        .eq("id", sessionID)
      if (sessErr) {
        throw new Error(`compaction: failed to update session: ${sessErr.message}`)
      }

      const tokensAfter = estimateHistoryTokens(tail) + Math.ceil(summary.length / 4)

      return {
        compacted: true,
        tokensBefore: before,
        tokensAfter,
        summary,
        messagesCompactedCount: head.length,
      }
    }

    const compactIfNeeded: Interface["compactIfNeeded"] = (input) =>
      Effect.gen(function* () {
        const history = yield* sessions.history(input.sessionID)
        const tokens = estimateHistoryTokens(history)
        const threshold = input.threshold ?? DEFAULT_THRESHOLD
        if (!isOverflow(tokens, threshold)) {
          return { compacted: false, tokensBefore: tokens }
        }
        const llm = yield* provider.model(input.model)
        return yield* Effect.tryPromise({
          try: () =>
            runCompaction(
              history,
              llm,
              input.keepTail ?? 4,
              input.sessionID,
              input.abortSignal,
            ),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })

    const forceCompact: Interface["forceCompact"] = (input) =>
      Effect.gen(function* () {
        const history = yield* sessions.history(input.sessionID)
        const llm = yield* provider.model(input.model)
        return yield* Effect.tryPromise({
          try: () =>
            runCompaction(
              history,
              llm,
              input.keepTail ?? 4,
              input.sessionID,
              input.abortSignal,
            ),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })

    return Service.of({ compactIfNeeded, forceCompact })
  }),
)

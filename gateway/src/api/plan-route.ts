import { Effect, Stream } from "effect"
import type { Context as HonoContext } from "hono"
import { streamSSE } from "hono/streaming"
import { PlanRequest, Service as PlannerService, type Interface as PlannerInterface } from "../planner"
import { Service as BusService, BusEvent, type Interface as BusInterface } from "../bus"
import { Service as ConfigService, type Config } from "../config"
import { PromptEvent } from "../session/prompt"
import type { z } from "zod"

/**
 * POST /plan — External-facing Hono handler.
 *
 * Contract (see gateway/plans/PLAN.md §API):
 *   request:  { question, agents[], preferences?, session_id? }
 *   response: SSE stream — session, plan, task.started*, task.artifact*,
 *             task.finished*, final, done
 */

type ConfigInfo = z.infer<typeof Config>

export const buildPlanHandler = Effect.gen(function* () {
  const planner = yield* PlannerService
  const bus = yield* BusService
  const cfg = yield* (yield* ConfigService).get()

  return (c: HonoContext) => handleRequest(c, planner, bus, cfg)
})

async function handleRequest(
  c: HonoContext,
  planner: PlannerInterface,
  bus: BusInterface,
  cfg: ConfigInfo,
): Promise<Response> {
  // 1. Auth (bearer)
  const authConfig = cfg.gateway.auth
  if (authConfig.mode === "bearer") {
    const header = c.req.header("Authorization")
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined
    if (!token || !authConfig.tokens.includes(token)) {
      return c.json({ error: "unauthorized" }, 401)
    }
  }

  // 2. Parse body
  let request: PlanRequest
  try {
    const body = await c.req.json()
    request = PlanRequest.parse(body)
  } catch (e) {
    return c.json({ error: "invalid_request", detail: (e as Error).message }, 400)
  }

  // 3. SSE response — subscribe to bus BEFORE kicking off the plan so we
  // don't miss the first event.
  return streamSSE(c, async (stream) => {
    const ac = new AbortController()
    c.req.raw.signal?.addEventListener("abort", () => ac.abort(), { once: true })

    // Spawn subscribers. Their readers write SSE frames; when the AbortController
    // fires, Effect.runPromise resolves (stream closes) and we stop writing.
    spawnReader(ac.signal, bus.subscribe(PromptEvent.Started), async (evt) => {
      await stream.writeSSE({
        event: "plan",
        data: JSON.stringify({
          plan_id: evt.properties.messageID,
          session_id: evt.properties.sessionID,
        }),
      })
    })

    spawnReader(ac.signal, bus.subscribe(PromptEvent.TextDelta), async (evt) => {
      await stream.writeSSE({
        event: "text.delta",
        data: JSON.stringify({
          session_id: evt.properties.sessionID,
          part_id: evt.properties.partID,
          delta: evt.properties.delta,
        }),
      })
    })

    spawnReader(ac.signal, bus.subscribe(PromptEvent.ToolCallStart), async (evt) => {
      await stream.writeSSE({
        event: "task.started",
        data: JSON.stringify({
          task_id: evt.properties.callID,
          agent: parseAgentFromTool(evt.properties.tool),
          skill: parseSkillFromTool(evt.properties.tool),
          input: evt.properties.input,
        }),
      })
    })

    spawnReader(ac.signal, bus.subscribe(PromptEvent.ToolCallEnd), async (evt) => {
      await stream.writeSSE({
        event: "task.artifact",
        data: JSON.stringify({
          task_id: evt.properties.callID,
          content: evt.properties.output,
          title: evt.properties.title,
        }),
      })
      await stream.writeSSE({
        event: "task.finished",
        data: JSON.stringify({
          task_id: evt.properties.callID,
          state: evt.properties.error ? "failed" : "completed",
          ...(evt.properties.error ? { error: evt.properties.error } : {}),
        }),
      })
    })

    spawnReader(ac.signal, bus.subscribe(PromptEvent.Finished), async (evt) => {
      await stream.writeSSE({
        event: "final",
        data: JSON.stringify({
          session_id: evt.properties.sessionID,
          stop_reason: evt.properties.stopReason,
          usage: evt.properties.usage,
        }),
      })
    })

    // 4. Kick off the plan
    try {
      const result = await Effect.runPromise(
        planner.startPlan(request, { abort: ac.signal }),
      )

      await stream.writeSSE({
        event: "session",
        data: JSON.stringify({
          session_id: result.sessionID,
          external_session_id: result.externalSessionID,
          created: !request.session_id,
        }),
      })

      // Give the bus event subscribers a tick to flush the final frame
      // before closing.
      await new Promise((r) => setTimeout(r, 100))
    } catch (e) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (e as Error).message }),
      })
    } finally {
      ac.abort()
      await stream.writeSSE({ event: "done", data: "{}" })
    }
  })
}

function spawnReader<T>(
  signal: AbortSignal,
  source: Stream.Stream<T>,
  cb: (evt: T) => Promise<void>,
): void {
  void Effect.runPromise(
    Stream.runForEach(source, (evt) =>
      Effect.promise(async () => {
        if (signal.aborted) return
        try {
          await cb(evt)
        } catch {
          /* swallow — one write failure shouldn't kill the plan */
        }
      }),
    ),
  ).catch(() => {
    /* stream shut down */
  })
}

function parseAgentFromTool(toolId: string): string {
  const m = toolId.match(/^call_(.+?)_(.+)$/)
  return m?.[1] ?? toolId
}

function parseSkillFromTool(toolId: string): string {
  const m = toolId.match(/^call_(.+?)_(.+)$/)
  return m?.[2] ?? ""
}

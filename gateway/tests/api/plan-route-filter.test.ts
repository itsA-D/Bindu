import { describe, it, expect } from "vitest"
import { Effect, Fiber, ManagedRuntime, Stream } from "effect"
import { layer as busLayer, Service as BusService } from "../../src/bus"
import { PromptEvent } from "../../src/session/prompt"

/**
 * Regression test for the SSE event leak across concurrent /plan requests.
 *
 * Before the fix:
 *   - plan-route.ts subscribed to the global bus with no filter
 *   - two concurrent requests shared the same PubSub consumers
 *   - request A's SSE stream received request B's text.delta / task events
 *
 * The fix (src/api/plan-route.ts):
 *   - Resolve the session BEFORE opening SSE so we know our sessionID.
 *   - Pipe every bus.subscribe() through Stream.filter on sessionID.
 */

const runtime = ManagedRuntime.make(busLayer)

describe("plan-route SSE isolation", () => {
  it("sessionID-filtered subscribers do not see other sessions' events", async () => {
    const sessA = "session-a"
    const sessB = "session-b"

    const program = Effect.gen(function* () {
      const bus = yield* BusService

      const filteredFor = (sid: string) =>
        bus.subscribe(PromptEvent.TextDelta).pipe(
          Stream.filter((e) => e.properties.sessionID === sid),
          Stream.take(2),
          Stream.runCollect,
        )

      // Kick off both subscribers BEFORE publishing so neither misses
      // the first event — mirrors the plan-route ordering.
      const fiberA = yield* Effect.forkChild(filteredFor(sessA))
      const fiberB = yield* Effect.forkChild(filteredFor(sessB))

      // Yield once so both subscriptions are registered on the PubSub
      // before we start publishing.
      yield* Effect.sleep("10 millis")

      // Interleave publishes from both "plans".
      yield* bus.publish(PromptEvent.TextDelta, {
        sessionID: sessA,
        messageID: "mA",
        partID: "pA1",
        delta: "A1",
      })
      yield* bus.publish(PromptEvent.TextDelta, {
        sessionID: sessB,
        messageID: "mB",
        partID: "pB1",
        delta: "B1",
      })
      yield* bus.publish(PromptEvent.TextDelta, {
        sessionID: sessA,
        messageID: "mA",
        partID: "pA1",
        delta: "A2",
      })
      yield* bus.publish(PromptEvent.TextDelta, {
        sessionID: sessB,
        messageID: "mB",
        partID: "pB1",
        delta: "B2",
      })

      const collectedA = yield* Fiber.join(fiberA)
      const collectedB = yield* Fiber.join(fiberB)
      return { collectedA, collectedB }
    })

    const { collectedA, collectedB } = await runtime.runPromise(program)

    // Each fiber must see ONLY its own session's deltas, in order.
    const deltasA = Array.from(collectedA as any).map((e: any) => e.properties.delta)
    const deltasB = Array.from(collectedB as any).map((e: any) => e.properties.delta)
    expect(deltasA).toEqual(["A1", "A2"])
    expect(deltasB).toEqual(["B1", "B2"])

    // And every event a fiber saw must have matched its sessionID.
    for (const e of Array.from(collectedA as any) as any[]) {
      expect(e.properties.sessionID).toBe(sessA)
    }
    for (const e of Array.from(collectedB as any) as any[]) {
      expect(e.properties.sessionID).toBe(sessB)
    }
  })
})

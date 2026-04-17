import { Context, Effect, Layer } from "effect"
import { randomUUID } from "crypto"
import { z } from "zod"
import { Service as SessionService, type MessageWithParts } from "../session"
import { Service as SessionPromptService } from "../session/prompt"
import { Service as SessionCompactionService } from "../session/compaction"
import { Service as DBService } from "../db"
import { Service as BusService } from "../bus"
import { Service as BinduClientService } from "../bindu/client"
import { Service as AgentService } from "../agent"
import { define, type Def } from "../tool/tool"
import type { Context as ToolContext, ExecuteResult } from "../tool/tool"
import type { PeerDescriptor } from "../bindu/client"
import type { PeerAuth } from "../bindu/auth/resolver"
import { BinduError } from "../bindu/protocol/jsonrpc"
import type { SessionID } from "../session/schema"

/**
 * Planner — turns External's agent catalog into dynamic tools, then runs
 * `SessionPrompt.prompt` with them to answer the user's question.
 *
 * This is the thin layer that adapts a single /plan request into one
 * agent-loop turn. The heavy logic (loop, streaming, tool execution) lives
 * in SessionPrompt; the Bindu network I/O lives in Client. Planner just
 * stitches them together.
 *
 * Dynamic tool naming:
 *   call_{agentName}_{skillId}
 *
 * Phase 0 learning applied: peer URL comes from the caller's agent.endpoint,
 * never from AgentCard.url. Caller is the single source of truth for where
 * to reach a given agent.
 */

// --------------------------------------------------------------------
// Plan request shape (matches PLAN.md §API)
// --------------------------------------------------------------------

export const PeerAuthRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("bearer_env"), envVar: z.string() }),
])

export const SkillRequest = z.object({
  id: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  outputModes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
})
export type SkillRequest = z.infer<typeof SkillRequest>

export const AgentRequest = z.object({
  name: z.string(),
  endpoint: z.string().url(),
  auth: PeerAuthRequest.optional(),
  trust: z
    .object({
      verifyDID: z.boolean().optional(),
      pinnedDID: z.string().optional(),
    })
    .optional(),
  skills: z.array(SkillRequest).default([]),
})
export type AgentRequest = z.infer<typeof AgentRequest>

export const PlanPreferences = z
  .object({
    responseFormat: z.string().optional(),
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
  })
  .partial()
  .passthrough()

export const PlanRequest = z.object({
  question: z.string(),
  agents: z.array(AgentRequest).default([]),
  preferences: PlanPreferences.optional(),
  session_id: z.string().optional(),
})
export type PlanRequest = z.infer<typeof PlanRequest>

// --------------------------------------------------------------------
// Planner service
// --------------------------------------------------------------------

export interface StartPlanOutcome {
  sessionID: SessionID
  externalSessionID: string | null
  message: MessageWithParts
  tasksRecorded: string[]
}

export interface Interface {
  readonly startPlan: (request: PlanRequest, opts?: { abort?: AbortSignal }) => Effect.Effect<StartPlanOutcome, Error>
}

export class Service extends Context.Service<Service, Interface>()("@bindu/Planner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionService
    const prompt = yield* SessionPromptService
    const compaction = yield* SessionCompactionService
    const db = yield* DBService
    const bus = yield* BusService
    const client = yield* BinduClientService
    const agents = yield* AgentService

    const startPlan: Interface["startPlan"] = (request, opts) =>
      Effect.gen(function* () {
        const plannerAgent = yield* agents.get("planner")
        if (!plannerAgent) {
          return yield* Effect.fail(new Error('planner: no "planner" agent configured'))
        }

        // 1. Session — resume or create
        const existing = request.session_id
          ? yield* db.getSession({ externalId: request.session_id })
          : undefined

        const sessionRow = existing
          ? existing
          : yield* sessions.create({
              externalSessionID: request.session_id,
              agentCatalog: request.agents,
            })
        const sessionID = sessionRow.id as unknown as SessionID

        // 2. Persist the latest agent catalog (External may add agents over turns)
        if (existing) {
          yield* db.updateSessionCatalog(sessionID, request.agents)
        }

        // 3. Compact if the history is over threshold — BEFORE we add the new turn
        const model = plannerAgent.model ?? "anthropic/claude-opus-4-7"
        yield* compaction
          .compactIfNeeded({
            sessionID,
            model,
            abortSignal: opts?.abort,
          })
          .pipe(
            Effect.catch((e: Error) =>
              bus.publish(
                { type: "planner.compaction.failed", properties: z.object({ message: z.string() }) } as any,
                { message: e.message } as any,
              ),
            ),
          )

        // 4. Build dynamic tools from the agent catalog
        const contextId = sessionID
        const tasksRecorded: string[] = []
        const tools: Def[] = []

        for (const ag of request.agents) {
          const peer: PeerDescriptor = {
            name: ag.name,
            url: ag.endpoint,
            auth: ag.auth as PeerAuth | undefined,
            trust: ag.trust,
          }
          for (const sk of ag.skills) {
            tools.push(buildSkillTool(peer, sk, { client, db, contextId, tasksRecorded }))
          }
        }

        // 5. Kick off the prompt loop
        const message = yield* prompt.prompt({
          sessionID,
          agent: "planner",
          parts: [
            {
              id: randomUUID() as any,
              type: "text",
              text: request.question,
              time: { start: Date.now() },
            },
          ],
          tools,
          modelOverride: plannerAgent.model,
          stepsOverride: request.preferences?.maxSteps ?? plannerAgent.steps,
          abort: opts?.abort,
        })

        return {
          sessionID,
          externalSessionID: sessionRow.external_session_id,
          message,
          tasksRecorded,
        }
      })

    return Service.of({ startPlan })
  }),
)

// --------------------------------------------------------------------
// Tool factory — one Def per (peer, skill) pair
// --------------------------------------------------------------------

interface BuildToolDeps {
  client: {
    callPeer: (
      input: import("../bindu/client").CallPeerInput,
    ) => Effect.Effect<import("../bindu/client").CallPeerOutcome, BinduError>
  }
  db: {
    recordTask: (input: import("../db").RecordTaskInput) => Effect.Effect<import("../db").TaskRow, Error>
    finishTask: (input: import("../db").FinishTaskInput) => Effect.Effect<void, Error>
  }
  contextId: string
  tasksRecorded: string[]
}

function buildSkillTool(peer: PeerDescriptor, skill: SkillRequest, deps: BuildToolDeps): Def {
  const toolId = normalizeToolName(`call_${peer.name}_${skill.id}`)
  const description = skill.description ?? `Call the ${peer.name} agent's ${skill.id} skill.`

  const parameters = jsonSchemaToZod(skill.inputSchema) ?? z.object({}).passthrough()

  const info = define(toolId, {
    description,
    parameters,
    execute: (args: unknown, ctx: ToolContext) =>
      Effect.gen(function* () {
        // 1. Record the task in our audit DB up-front
        const taskRow = yield* deps.db.recordTask({
          sessionId: ctx.sessionId as unknown as string,
          agentName: peer.name,
          skillId: skill.id,
          endpointUrl: peer.url,
          input: args,
          state: "submitted",
        })
        deps.tasksRecorded.push(taskRow.id)

        // 2. Execute via the Bindu client
        const outcome = yield* deps.client
          .callPeer({
            peer,
            skill: skill.id,
            input: JSON.stringify(args),
            contextId: deps.contextId,
            signal: ctx.abort,
          })
          .pipe(
            Effect.tapError((err) =>
              deps.db.finishTask({
                id: taskRow.id,
                state: "failed",
                outputText: `BinduError ${err.code}: ${err.message}`,
              }),
            ),
            Effect.mapError((err) => err as unknown as Error),
          )

        // 3. Finish the audit row
        const remoteContextId = outcome.task.contextId
        const finalState =
          outcome.task.status.state === "completed" ||
          outcome.task.status.state === "failed" ||
          outcome.task.status.state === "canceled" ||
          outcome.task.status.state === "rejected"
            ? (outcome.task.status.state as any)
            : "completed"

        const outputText = extractOutputText(outcome.task)

        yield* deps.db.finishTask({
          id: taskRow.id,
          state: finalState,
          outputText,
          remoteContextId,
          usage: {
            polls: outcome.polls,
            terminal: outcome.terminal,
            signatures: outcome.signatures ?? undefined,
          },
        })

        // 4. Wrap the output in an untrusted-content envelope for the planner
        const wrapped = wrapRemoteContent({
          agentName: peer.name,
          did: peer.trust?.pinnedDID ?? null,
          verified: outcome.signatures?.ok ?? null,
          body: outputText,
        })

        const result: ExecuteResult = {
          title: `@${peer.name}/${skill.id}`,
          output: wrapped,
          metadata: {
            peer: peer.name,
            skill: skill.id,
            taskId: outcome.task.id,
            remoteContextId,
            polls: outcome.polls,
            signatures: outcome.signatures ?? null,
            needsAction: outcome.needsAction,
            state: outcome.task.status.state,
          },
        }
        return result
      }),
  })

  // Realize the info into a Def right here — the registry wants Defs, and
  // the init is trivial (no async setup for dynamic tools).
  return {
    id: info.id,
    description,
    parameters,
    execute: (args: unknown, ctx: ToolContext) =>
      Effect.flatMap(info.init(), (init) => init.execute(args, ctx)),
  }
}

function normalizeToolName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80)
}

function extractOutputText(task: import("../bindu/protocol/types").Task): string {
  const pieces: string[] = []
  for (const art of task.artifacts ?? []) {
    for (const p of art.parts ?? []) {
      if (p.kind === "text") pieces.push(p.text)
      else if (p.kind === "data") pieces.push(JSON.stringify(p.data))
      else if (p.kind === "file" && p.text) pieces.push(p.text)
    }
  }
  if (pieces.length === 0) return `[task ${task.id} ${task.status.state} — no text output]`
  return pieces.join("\n\n")
}

function wrapRemoteContent(input: {
  agentName: string
  did: string | null
  verified: boolean | null
  body: string
}): string {
  const verified = input.verified === null ? "unknown" : input.verified ? "yes" : "no"
  const didAttr = input.did ? ` did="${escapeAttr(input.did)}"` : ""
  // Scrub nested envelope markers and common injection phrases so a
  // malicious peer can't forge a wrapper inside their own response.
  const scrubbed = input.body
    .replace(/<\/?remote_content[^>]*>/gi, "[stripped]")
    .replace(/\b(ignore (?:all )?previous|disregard earlier)\b/gi, "[stripped]")

  return `<remote_content agent="${escapeAttr(input.agentName)}"${didAttr} verified="${verified}">
${scrubbed}
</remote_content>`
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// --------------------------------------------------------------------
// JSON Schema → Zod (minimal — only the shapes deployed agents send)
// --------------------------------------------------------------------

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny | null {
  if (!schema || typeof schema !== "object") return null
  const s = schema as Record<string, any>
  switch (s.type) {
    case "string":
      return z.string()
    case "number":
      return z.number()
    case "integer":
      return z.number().int()
    case "boolean":
      return z.boolean()
    case "array": {
      const items = jsonSchemaToZod(s.items) ?? z.any()
      return z.array(items)
    }
    case "object": {
      const props = (s.properties as Record<string, unknown>) ?? {}
      const required = new Set<string>((s.required as string[]) ?? [])
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [k, v] of Object.entries(props)) {
        const inner = jsonSchemaToZod(v) ?? z.any()
        shape[k] = required.has(k) ? inner : inner.optional()
      }
      return z.object(shape).passthrough()
    }
    default:
      return z.any()
  }
}

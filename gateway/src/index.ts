import "./bindu/identity" // bootstrap ed25519 sha512 hook FIRST
import { Effect, Layer, ManagedRuntime } from "effect"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import * as Config from "./config"
import * as Bus from "./bus"
import * as Auth from "./auth"
import * as DB from "./db"
import * as Permission from "./permission"
import * as Provider from "./provider"
import * as Skill from "./skill"
import * as Agent from "./agent"
import * as Session from "./session"
import * as SessionCompaction from "./session/compaction"
import * as SessionRevert from "./session/revert"
import * as SessionPrompt from "./session/prompt"
import * as ToolRegistry from "./tool/registry"
import * as BinduClient from "./bindu/client"
import * as Server from "./server"
import * as Planner from "./planner"
import { buildPlanHandler } from "./api/plan-route"
import {
  loadLocalIdentity,
  type LocalIdentity,
} from "./bindu/identity/local"

/**
 * Bindu Gateway boot.
 *
 * Composes all services into one Layer, builds a ManagedRuntime, wires the
 * Hono routes onto the server, binds a port, and exports a `shutdown`
 * function for graceful restarts.
 *
 * Import order matters once: `./bindu/identity` runs the ed25519 sha512
 * bootstrap before anything else tries to verify a signature.
 */

// Layered bottom-up. Each `provideMerge` produces a layer that both
// *provides* the services it wires AND exposes them to outer layers.
//
// The composition is wrapped in a factory so the gateway's DID
// identity (loaded from env at boot) can be injected into the
// BinduClient layer. Peers configured with auth.type=did_signed use
// this identity's private key to sign outbound bodies.

function buildAppLayer(identity: LocalIdentity | undefined) {
  // Level 1 — zero-dependency services
  const level1 = Layer.mergeAll(
    Config.layer,
    Bus.layer,
    Auth.layer,
    Permission.layer,
    ToolRegistry.layer,
    BinduClient.makeLayer(identity),
    Skill.defaultLayer,
  )

  // Level 2 — need Config (implicitly resolved by provideMerge)
  const level2 = Layer.mergeAll(
    DB.layer,
    Provider.layer,
    Agent.layer(),
    Server.layer,
  ).pipe(Layer.provideMerge(level1))

  // Level 3 — Session needs DB; Revert needs DB
  const level3 = Layer.mergeAll(Session.layer, SessionRevert.layer).pipe(
    Layer.provideMerge(level2),
  )

  // Level 4 — Compaction needs Session + DB + Provider
  const level4 = SessionCompaction.layer.pipe(Layer.provideMerge(level3))

  // Level 5 — Prompt needs Session, Agent, Config, Registry, Bus, Provider, Permission
  const level5 = SessionPrompt.layer.pipe(Layer.provideMerge(level4))

  // Level 6 — Planner needs everything from below
  return Planner.layer.pipe(Layer.provideMerge(level5))
}

/**
 * Default export kept for backward compat — a layer built without
 * a DID identity. did_signed peers will fail at call time with a
 * clear error pointing at BINDU_GATEWAY_DID_SEED.
 */
export const appLayer = buildAppLayer(undefined)

/**
 * Load the gateway's DID identity from environment if all required
 * pieces are present. Returns ``undefined`` when identity is not
 * configured — the gateway then runs in its pre-DID mode (talking
 * only to ``none`` / ``bearer`` / ``bearer_env`` peers).
 *
 * Required env vars (all three must be set):
 *
 *   - ``BINDU_GATEWAY_DID_SEED`` — 32-byte Ed25519 seed, base64
 *   - ``BINDU_GATEWAY_AUTHOR``   — author identifier (typically email)
 *   - ``BINDU_GATEWAY_NAME``     — short gateway name
 *
 * Throws if the seed env var IS set but malformed (wrong length, bad
 * base64) — a misconfigured gateway should fail fast at boot, not
 * three layers into a peer call.
 */
export function tryLoadIdentity(): LocalIdentity | undefined {
  const author = process.env.BINDU_GATEWAY_AUTHOR
  const name = process.env.BINDU_GATEWAY_NAME
  const hasSeed = Boolean(process.env.BINDU_GATEWAY_DID_SEED)

  if (!hasSeed && !author && !name) return undefined

  if (!hasSeed || !author || !name) {
    throw new Error(
      "Partial DID identity config — set all three or none: " +
        "BINDU_GATEWAY_DID_SEED, BINDU_GATEWAY_AUTHOR, BINDU_GATEWAY_NAME. " +
        `Got: seed=${hasSeed ? "set" : "missing"}, author=${author ? "set" : "missing"}, name=${name ? "set" : "missing"}`,
    )
  }

  return loadLocalIdentity({ author, name })
}

export async function main(): Promise<{ close: () => Promise<void> }> {
  const identity = tryLoadIdentity()
  if (identity) {
    console.log(`[bindu-gateway] DID identity loaded: ${identity.did}`)
    console.log(
      `[bindu-gateway] public key (base58): ${identity.publicKeyBase58}`,
    )
    console.log(
      `[bindu-gateway] register this DID + public key with each peer's Hydra ` +
        `before talking to auth.type=did_signed peers.`,
    )
  } else {
    console.log(
      `[bindu-gateway] no DID identity configured (set BINDU_GATEWAY_DID_SEED, ` +
        `_AUTHOR, _NAME to enable did_signed peer auth)`,
    )
  }

  const runtime = ManagedRuntime.make(buildAppLayer(identity))

  const cfg = await runtime.runPromise(
    Effect.gen(function* () {
      const c = yield* Config.Service
      return yield* c.get()
    }),
  )

  const planHandler = await runtime.runPromise(buildPlanHandler)

  const app: Hono = await runtime.runPromise(
    Effect.gen(function* () {
      const s = yield* Server.Service
      return s.app
    }),
  )

  app.post("/plan", planHandler)

  const { port, hostname } = cfg.gateway.server
  const httpServer = serve({ fetch: app.fetch, port, hostname })

  console.log(`[bindu-gateway] listening on http://${hostname}:${port}`)
  console.log(`[bindu-gateway] session mode: ${cfg.gateway.session.mode}`)

  return {
    close: async () => {
      httpServer.close()
      await runtime.dispose()
    },
  }
}

// ESM entry: only run if invoked directly
const isMain =
  typeof process !== "undefined" && process.argv[1]?.endsWith("/index.ts") // tsx/bun
if (isMain) {
  main().catch((e) => {
    console.error("[bindu-gateway] boot failed:", e)
    process.exit(1)
  })
}

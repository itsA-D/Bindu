/**
 * Tests for the boot-time identity loader. Keeps the partial-env
 * misconfig fail-fast behavior from regressing silently.
 *
 * Why this matters: half-loaded identity is the worst of all worlds.
 * The gateway would start fine, then produce mysterious 403s the
 * moment anything touches a did_signed peer. Better to refuse boot.
 */

import { describe, it, expect, afterEach } from "vitest"
import { tryLoadIdentity } from "../src/index"

const SEED_VAR = "BINDU_GATEWAY_DID_SEED"
const AUTHOR_VAR = "BINDU_GATEWAY_AUTHOR"
const NAME_VAR = "BINDU_GATEWAY_NAME"

function clearIdentityEnv() {
  delete process.env[SEED_VAR]
  delete process.env[AUTHOR_VAR]
  delete process.env[NAME_VAR]
}

describe("tryLoadIdentity", () => {
  afterEach(clearIdentityEnv)

  it("returns undefined when all three env vars are unset", () => {
    clearIdentityEnv()
    expect(tryLoadIdentity()).toBeUndefined()
  })

  it("throws clear error when seed is set but author+name are missing", () => {
    clearIdentityEnv()
    process.env[SEED_VAR] = Buffer.from(new Uint8Array(32)).toString("base64")
    expect(() => tryLoadIdentity()).toThrow(/Partial DID identity config/)
  })

  it("throws clear error when author is set but seed+name are missing", () => {
    clearIdentityEnv()
    process.env[AUTHOR_VAR] = "ops@example.com"
    expect(() => tryLoadIdentity()).toThrow(/Partial DID identity config/)
  })

  it("loads a working identity when all three are set", () => {
    clearIdentityEnv()
    process.env[SEED_VAR] = Buffer.from(new Uint8Array(32)).toString("base64")
    process.env[AUTHOR_VAR] = "ops@example.com"
    process.env[NAME_VAR] = "gateway"
    const id = tryLoadIdentity()
    expect(id).toBeDefined()
    expect(id!.did).toMatch(/^did:bindu:ops_at_example_com:gateway:/)
  })

  it("surfaces seed malformation clearly when author+name are valid", () => {
    clearIdentityEnv()
    process.env[SEED_VAR] = "not-base64!"
    process.env[AUTHOR_VAR] = "ops@example.com"
    process.env[NAME_VAR] = "gateway"
    expect(() => tryLoadIdentity()).toThrow(/32 bytes/)
  })
})

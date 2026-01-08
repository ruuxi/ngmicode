import { describe, expect, test } from "bun:test"
import { PlanMode } from "../../src/session/plan-mode"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("PlanMode", () => {
  test("review publishes and reply resolves", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const reviewed: PlanMode.Request[] = []
        const responded: PlanMode.Response[] = []
        const unsubReview = Bus.subscribe(PlanMode.Event.PlanReview, (event) => {
          reviewed.push(event.properties)
        })
        const unsubResponded = Bus.subscribe(PlanMode.Event.PlanResponded, (event) => {
          responded.push(event.properties)
        })

        const promise = PlanMode.review({
          sessionID: "session-3",
          messageID: "message-3",
          callID: "call-3",
          plan: "step one\nstep two",
        })

        const pending = PlanMode.listForSession("session-3")
        expect(pending.length).toBe(1)
        const request = pending[0]
        const ok = PlanMode.reply({
          requestID: request.id,
          approved: true,
        })
        const approved = await promise

        unsubReview()
        unsubResponded()

        expect(ok).toBe(true)
        expect(approved).toBe(true)
        expect(PlanMode.listForSession("session-3").length).toBe(0)
        expect(reviewed.length).toBe(1)
        expect(responded.length).toBe(1)
        expect(reviewed[0].id).toBe(request.id)
        expect(responded[0].requestID).toBe(request.id)
      },
    })
  })

  test("cancel rejects pending plan and listForSession scopes entries", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = PlanMode.review({
          sessionID: "session-4",
          messageID: "message-4",
          callID: "call-4",
          plan: "plan body",
        })

        const pending = PlanMode.listForSession("session-4")
        expect(pending.length).toBe(1)
        const request = pending[0]
        const canceled = PlanMode.cancel(request.id)
        const missing = PlanMode.cancel("permission_missing")

        await expect(promise).rejects.toThrow("Plan review cancelled")

        expect(canceled).toBe(true)
        expect(missing).toBe(false)
        expect(PlanMode.listForSession("session-4").length).toBe(0)
      },
    })
  })
})

import { describe, expect, test } from "bun:test"
import { AskUserQuestion } from "../../src/session/ask-user-question"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("AskUserQuestion", () => {
  test("ask publishes and reply resolves", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked: AskUserQuestion.Request[] = []
        const replied: AskUserQuestion.Response[] = []
        const unsubAsked = Bus.subscribe(AskUserQuestion.Event.Asked, (event) => {
          asked.push(event.properties)
        })
        const unsubReplied = Bus.subscribe(AskUserQuestion.Event.Replied, (event) => {
          replied.push(event.properties)
        })

        const promise = AskUserQuestion.ask({
          sessionID: "session-1",
          messageID: "message-1",
          callID: "call-1",
          questions: [
            {
              question: "confirm",
              header: "Confirm",
              options: [{ label: "ok", description: "ok" }],
              multiSelect: false,
            },
          ],
        })

        const pending = AskUserQuestion.listForSession("session-1")
        expect(pending.length).toBe(1)
        const request = pending[0]
        const ok = AskUserQuestion.reply({
          requestID: request.id,
          answers: { confirm: "ok" },
        })
        const answers = await promise

        unsubAsked()
        unsubReplied()

        expect(ok).toBe(true)
        expect(answers).toEqual({ confirm: "ok" })
        expect(AskUserQuestion.listForSession("session-1").length).toBe(0)
        expect(asked.length).toBe(1)
        expect(replied.length).toBe(1)
        expect(asked[0].id).toBe(request.id)
        expect(replied[0].requestID).toBe(request.id)
      },
    })
  })

  test("cancel rejects pending question and listForSession scopes entries", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = AskUserQuestion.ask({
          sessionID: "session-2",
          messageID: "message-2",
          callID: "call-2",
          questions: [
            {
              question: "mode",
              header: "Mode",
              options: [{ label: "fast", description: "fast" }],
              multiSelect: false,
            },
          ],
        })

        const pending = AskUserQuestion.listForSession("session-2")
        expect(pending.length).toBe(1)
        const request = pending[0]
        const canceled = AskUserQuestion.cancel(request.id)
        const missing = AskUserQuestion.cancel("askuser_missing")

        await expect(promise).rejects.toThrow("Question cancelled")

        expect(canceled).toBe(true)
        expect(missing).toBe(false)
        expect(AskUserQuestion.listForSession("session-2").length).toBe(0)
      },
    })
  })
})

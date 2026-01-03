import type { Message, Session, Part, FileDiff, SessionStatus, PermissionRequest } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type AskUserQuestionRequest = {
  id: string
  sessionID: string
  messageID: string
  callID: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}

export type PlanModeRequest = {
  id: string
  sessionID: string
  messageID: string
  callID: string
  plan: string
}

type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  askuser?: {
    [sessionID: string]: AskUserQuestionRequest[]
  }
  planmode?: {
    [sessionID: string]: PlanModeRequest[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type AskUserRespondFn = (input: {
  requestID: string
  answers: Record<string, string>
}) => void

export type PlanModeRespondFn = (input: {
  requestID: string
  approved: boolean
}) => void

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
    onAskUserRespond?: AskUserRespondFn
    onPlanModeRespond?: PlanModeRespondFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
      respondToAskUser: props.onAskUserRespond,
      respondToPlanMode: props.onPlanModeRespond,
    }
  },
})

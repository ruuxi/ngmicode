import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import z from "zod"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })

  export const CleanupMode = z.enum(["ask", "always", "never"])
  export type CleanupMode = z.infer<typeof CleanupMode>

  export const Info = z
    .object({
      path: z.string(),
      cleanup: CleanupMode.default("ask"),
    })
    .meta({
      ref: "WorktreeInfo",
    })
  export type Info = z.infer<typeof Info>

  /**
   * Generate the worktree path for a session.
   * Places worktree adjacent to main repo: ../reponame-session-{sessionId}
   */
  export function getPath(sessionID: string): string {
    const repoPath = Instance.worktree
    const repoName = path.basename(repoPath)
    const parentDir = path.dirname(repoPath)
    return path.join(parentDir, `${repoName}-session-${sessionID}`)
  }

  /**
   * Create a detached worktree for a session.
   * Uses current HEAD as the starting point.
   */
  export async function create(input: {
    sessionID: string
    cleanup?: CleanupMode
  }): Promise<Info> {
    const worktreePath = getPath(input.sessionID)

    // Check if path already exists
    const exists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false)

    if (exists) {
      // Try with a unique suffix
      const uniquePath = `${worktreePath}-${Date.now()}`
      log.warn("worktree path exists, using unique suffix", {
        original: worktreePath,
        unique: uniquePath,
      })
      return createAtPath(uniquePath, input.cleanup ?? "ask")
    }

    return createAtPath(worktreePath, input.cleanup ?? "ask")
  }

  async function createAtPath(worktreePath: string, cleanup: CleanupMode): Promise<Info> {
    log.info("creating worktree", { path: worktreePath })

    // Create worktree with detached HEAD at current commit
    const result = await $`git worktree add --detach ${worktreePath}`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.error("failed to create worktree", {
        path: worktreePath,
        exitCode: result.exitCode,
        stderr,
      })
      throw new WorktreeError({
        operation: "create",
        path: worktreePath,
        message: stderr || "Failed to create worktree",
      })
    }

    log.info("worktree created", { path: worktreePath })

    return {
      path: worktreePath,
      cleanup,
    }
  }

  /**
   * Remove a worktree.
   */
  export async function remove(worktreePath: string): Promise<void> {
    log.info("removing worktree", { path: worktreePath })

    // First try git worktree remove
    const result = await $`git worktree remove ${worktreePath} --force`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.warn("git worktree remove failed, trying manual cleanup", {
        path: worktreePath,
        stderr,
      })

      // Try manual cleanup
      try {
        await fs.rm(worktreePath, { recursive: true, force: true })
        // Also prune worktree references
        await $`git worktree prune`.cwd(Instance.worktree).quiet().nothrow()
        log.info("worktree manually removed", { path: worktreePath })
      } catch (err) {
        log.error("failed to remove worktree", { path: worktreePath, error: err })
        throw new WorktreeError({
          operation: "remove",
          path: worktreePath,
          message: "Failed to remove worktree",
        })
      }
      return
    }

    log.info("worktree removed", { path: worktreePath })
  }

  /**
   * Check if a worktree exists.
   */
  export async function exists(worktreePath: string): Promise<boolean> {
    const dirExists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false)

    if (!dirExists) return false

    // Verify it's actually a git worktree
    const result = await $`git worktree list --porcelain`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) return false

    const normalized = path.normalize(worktreePath)
    return result
      .text()
      .split("\n")
      .some((line) => {
        if (!line.startsWith("worktree ")) return false
        const listedPath = path.normalize(line.slice("worktree ".length))
        return listedPath === normalized
      })
  }

  /**
   * List all worktrees for the current repository.
   */
  export async function list(): Promise<string[]> {
    const result = await $`git worktree list --porcelain`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) return []

    return result
      .text()
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
  }

  export class WorktreeError extends Error {
    constructor(
      public readonly info: {
        operation: "create" | "remove"
        path: string
        message: string
      },
    ) {
      super(`Worktree ${info.operation} failed: ${info.message}`)
      this.name = "WorktreeError"
    }
  }
}

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
      branch: z.string(),
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
   * Get the branch name for a session worktree.
   */
  export function getBranchName(sessionID: string): string {
    return `opencode/session-${sessionID}`
  }

  /**
   * Create a worktree with a dedicated branch for a session.
   * Creates branch opencode/session-{sessionID} at current HEAD.
   */
  export async function create(input: {
    sessionID: string
    cleanup?: CleanupMode
  }): Promise<Info> {
    const worktreePath = getPath(input.sessionID)
    const branchName = getBranchName(input.sessionID)

    // Check if path already exists
    const pathExists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false)

    if (pathExists) {
      // Try with a unique suffix
      const uniqueSuffix = Date.now().toString(36)
      const uniquePath = `${worktreePath}-${uniqueSuffix}`
      const uniqueBranch = `${branchName}-${uniqueSuffix}`
      log.warn("worktree path exists, using unique suffix", {
        original: worktreePath,
        unique: uniquePath,
      })
      return createAtPath(uniquePath, uniqueBranch, input.cleanup ?? "ask")
    }

    return createAtPath(worktreePath, branchName, input.cleanup ?? "ask")
  }

  async function createAtPath(
    worktreePath: string,
    branchName: string,
    cleanup: CleanupMode,
  ): Promise<Info> {
    log.info("creating worktree with branch", { path: worktreePath, branch: branchName })

    // Create worktree with a new branch at current HEAD
    const result = await $`git worktree add -b ${branchName} ${worktreePath}`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.error("failed to create worktree", {
        path: worktreePath,
        branch: branchName,
        exitCode: result.exitCode,
        stderr,
      })
      throw new WorktreeError({
        operation: "create",
        path: worktreePath,
        message: stderr || "Failed to create worktree",
      })
    }

    log.info("worktree created", { path: worktreePath, branch: branchName })

    return {
      path: worktreePath,
      branch: branchName,
      cleanup,
    }
  }

  /**
   * Remove a worktree and optionally its branch.
   */
  export async function remove(input: {
    path: string
    branch?: string
    deleteBranch?: boolean
  }): Promise<void> {
    const { path: worktreePath, branch, deleteBranch = true } = input
    log.info("removing worktree", { path: worktreePath, branch, deleteBranch })

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
    } else {
      log.info("worktree removed", { path: worktreePath })
    }

    // Delete the branch if requested
    if (branch && deleteBranch) {
      log.info("deleting branch", { branch })
      const branchResult = await $`git branch -D ${branch}`
        .cwd(Instance.worktree)
        .quiet()
        .nothrow()

      if (branchResult.exitCode !== 0) {
        log.warn("failed to delete branch", {
          branch,
          stderr: branchResult.stderr.toString(),
        })
        // Don't throw - worktree is already removed, branch cleanup is best-effort
      } else {
        log.info("branch deleted", { branch })
      }
    }
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

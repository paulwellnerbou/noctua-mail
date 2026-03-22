import { getAccounts, updateMessageFolder } from "@/lib/db";
import { moveImapMessage } from "@/lib/mail/imap";

export type QueuedMessageMove = {
  accountId: string;
  messageId: string;
  sourceFolderId: string;
  sourceMailboxPath: string;
  sourceUid: number;
  destinationFolderId: string;
  destinationMailboxPath: string;
  clientId?: string;
};

type AccountMoveState = {
  running: boolean;
  tasks: QueuedMessageMove[];
};

type MessageMoveRuntimeState = {
  accountStates: Map<string, AccountMoveState>;
};

const runtimeState = globalThis as typeof globalThis & {
  __noctuaMessageMoveJobsState?: MessageMoveRuntimeState;
};

if (!runtimeState.__noctuaMessageMoveJobsState) {
  runtimeState.__noctuaMessageMoveJobsState = {
    accountStates: new Map<string, AccountMoveState>()
  };
}

const accountStates = runtimeState.__noctuaMessageMoveJobsState.accountStates;

function getOrCreateAccountState(accountId: string) {
  const existing = accountStates.get(accountId);
  if (existing) return existing;
  const created: AccountMoveState = { running: false, tasks: [] };
  accountStates.set(accountId, created);
  return created;
}

async function rollbackMessageMove(task: QueuedMessageMove) {
  try {
    await updateMessageFolder(
      task.accountId,
      task.messageId,
      task.sourceFolderId,
      task.sourceMailboxPath,
      task.sourceUid
    );
  } catch (error) {
    console.warn("[move-jobs] failed to rollback message move", {
      accountId: task.accountId,
      messageId: task.messageId,
      error
    });
  }
}

async function processAccountQueue(accountId: string, state: AccountMoveState) {
  if (state.running) return;
  state.running = true;
  try {
    while (state.tasks.length > 0) {
      const task = state.tasks.shift();
      if (!task) continue;
      const accounts = await getAccounts();
      const account = accounts.find((item) => item.id === accountId);
      if (!account) {
        await rollbackMessageMove(task);
        continue;
      }
      try {
        const destinationUid = await moveImapMessage(
          account,
          task.sourceMailboxPath,
          task.sourceUid,
          task.destinationMailboxPath,
          task.clientId
        );
        await updateMessageFolder(
          task.accountId,
          task.messageId,
          task.destinationFolderId,
          task.destinationMailboxPath,
          destinationUid ?? null
        );
      } catch (error) {
        console.warn("[move-jobs] failed to move IMAP message", {
          accountId: task.accountId,
          messageId: task.messageId,
          sourceMailboxPath: task.sourceMailboxPath,
          sourceUid: task.sourceUid,
          destinationMailboxPath: task.destinationMailboxPath,
          error
        });
        await rollbackMessageMove(task);
      }
    }
  } finally {
    state.running = false;
    if (state.tasks.length === 0) {
      accountStates.delete(accountId);
    }
  }
}

/**
 * Returns IMAP UIDs that are queued for move OUT of the given source folder.
 * Used by two-phase sync to avoid re-downloading messages that have been
 * staged for move but not yet IMAP-moved (the IMAP server still has them,
 * but the local DB no longer associates them with the source folder).
 */
export function getPendingMoveSourceUids(
  accountId: string,
  sourceFolderId: string
): Set<number> {
  const state = accountStates.get(accountId);
  if (!state) return new Set();
  const uids = new Set<number>();
  state.tasks.forEach((task) => {
    if (task.sourceFolderId === sourceFolderId) {
      uids.add(task.sourceUid);
    }
  });
  return uids;
}

export function enqueueMessageMoveJobs(tasks: QueuedMessageMove[]) {
  if (tasks.length === 0) return;
  const byAccount = new Map<string, QueuedMessageMove[]>();
  tasks.forEach((task) => {
    const list = byAccount.get(task.accountId);
    if (list) {
      list.push(task);
    } else {
      byAccount.set(task.accountId, [task]);
    }
  });
  byAccount.forEach((accountTasks, accountId) => {
    const state = getOrCreateAccountState(accountId);
    accountTasks.forEach((task) => {
      const existingIndex = state.tasks.findIndex((item) => item.messageId === task.messageId);
      if (existingIndex >= 0) {
        state.tasks[existingIndex] = task;
      } else {
        state.tasks.push(task);
      }
    });
    void processAccountQueue(accountId, state);
  });
}

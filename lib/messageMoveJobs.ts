import { getAccounts, updateMessageFolder } from "@/lib/db";
import { moveImapMessages } from "@/lib/mail/imap";

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
  inFlight: QueuedMessageMove[];
  runningPromise: Promise<void> | null;
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
const MOVE_BATCH_SIZE = 200;

function getOrCreateAccountState(accountId: string) {
  const existing = accountStates.get(accountId);
  if (existing) return existing;
  const created: AccountMoveState = {
    running: false,
    tasks: [],
    inFlight: [],
    runningPromise: null
  };
  accountStates.set(accountId, created);
  return created;
}

function getTaskPairKey(task: QueuedMessageMove) {
  return `${task.sourceMailboxPath}\u0000${task.destinationMailboxPath}`;
}

function takeNextTaskBatch(state: AccountMoveState) {
  const head = state.tasks.shift();
  if (!head) return [] as QueuedMessageMove[];
  const pairKey = getTaskPairKey(head);
  const batch = [head];
  for (let index = 0; index < state.tasks.length && batch.length < MOVE_BATCH_SIZE; ) {
    const candidate = state.tasks[index];
    if (getTaskPairKey(candidate) !== pairKey) {
      index += 1;
      continue;
    }
    batch.push(candidate);
    state.tasks.splice(index, 1);
  }
  return batch;
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

async function rollbackMessageMoveBatch(tasks: QueuedMessageMove[]) {
  await Promise.all(tasks.map((task) => rollbackMessageMove(task)));
}

async function processAccountQueue(accountId: string, state: AccountMoveState) {
  if (state.running) return;
  state.running = true;
  try {
    while (state.tasks.length > 0) {
      const batch = takeNextTaskBatch(state);
      if (batch.length === 0) continue;
      state.inFlight = batch;

      const accounts = await getAccounts();
      const account = accounts.find((item) => item.id === accountId);
      if (!account) {
        state.inFlight = [];
        await rollbackMessageMoveBatch(batch);
        continue;
      }

      try {
        const uidMap = await moveImapMessages(
          account,
          batch[0]!.sourceMailboxPath,
          batch.map((task) => task.sourceUid),
          batch[0]!.destinationMailboxPath,
          batch[0]!.clientId
        );
        await Promise.all(
          batch.map((task) =>
            updateMessageFolder(
              task.accountId,
              task.messageId,
              task.destinationFolderId,
              task.destinationMailboxPath,
              uidMap.get(task.sourceUid) ?? null
            )
          )
        );
      } catch (error) {
        console.warn("[move-jobs] failed to move IMAP message batch", {
          accountId,
          messageIds: batch.map((task) => task.messageId),
          sourceMailboxPath: batch[0]?.sourceMailboxPath,
          sourceUidSample: batch.slice(0, 20).map((task) => task.sourceUid),
          destinationMailboxPath: batch[0]?.destinationMailboxPath,
          error
        });
        await rollbackMessageMoveBatch(batch);
      } finally {
        state.inFlight = [];
      }
    }
  } finally {
    state.running = false;
    state.runningPromise = null;
    if (state.tasks.length === 0) {
      accountStates.delete(accountId);
      return;
    }
    state.runningPromise = processAccountQueue(accountId, state);
  }
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
    if (!state.runningPromise) {
      state.runningPromise = processAccountQueue(accountId, state);
    }
  });
}

export async function waitForMessageMoveJobsIdle(accountId: string) {
  await accountStates.get(accountId)?.runningPromise;
}

type DraftAutoSaveStateInput = {
  baselineHash: string | null;
  composeDraftId: string | null;
  composeDirty: boolean;
  previousDraftSaving: boolean;
  draftSaving: boolean;
  hash: string;
  lastSavedHash: string;
  canAutoSave: boolean;
};

type DraftAutoSaveState = {
  initializeBaseline: boolean;
  syncLastSavedHashToCurrent: boolean;
  nextComposeDirty: boolean;
  shouldClearDirty: boolean;
  shouldScheduleSave: boolean;
};

export function getDraftAutoSaveState(input: DraftAutoSaveStateInput): DraftAutoSaveState {
  if (input.baselineHash === null) {
    return {
      initializeBaseline: true,
      syncLastSavedHashToCurrent: Boolean(input.composeDraftId) && !input.composeDirty,
      nextComposeDirty: input.composeDirty,
      shouldClearDirty: false,
      shouldScheduleSave: false
    };
  }

  const finishedDraftSave = input.previousDraftSaving && !input.draftSaving;
  let nextComposeDirty = input.composeDirty;
  if (input.hash === input.lastSavedHash) {
    nextComposeDirty = false;
  } else if (finishedDraftSave) {
    nextComposeDirty = true;
  }

  return {
    initializeBaseline: false,
    syncLastSavedHashToCurrent: false,
    nextComposeDirty,
    shouldClearDirty: !nextComposeDirty && input.hash === input.lastSavedHash,
    shouldScheduleSave: !input.draftSaving && input.canAutoSave && nextComposeDirty
  };
}

export type { DraftAutoSaveStateInput, DraftAutoSaveState };

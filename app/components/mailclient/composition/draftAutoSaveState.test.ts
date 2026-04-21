import { describe, expect, it } from "bun:test";
import { getDraftAutoSaveState } from "./draftAutoSaveState";

describe("getDraftAutoSaveState", () => {
  it("initializes the baseline without scheduling a save", () => {
    expect(
      getDraftAutoSaveState({
        baselineHash: null,
        composeDraftId: null,
        composeDirty: false,
        previousDraftSaving: false,
        draftSaving: false,
        hash: "hash-1",
        lastSavedHash: "",
        canAutoSave: true
      })
    ).toEqual({
      initializeBaseline: true,
      syncLastSavedHashToCurrent: false,
      nextComposeDirty: false,
      shouldClearDirty: false,
      shouldScheduleSave: false
    });
  });

  it("seeds the last-saved hash for an unchanged existing draft", () => {
    expect(
      getDraftAutoSaveState({
        baselineHash: null,
        composeDraftId: "draft-1",
        composeDirty: false,
        previousDraftSaving: false,
        draftSaving: false,
        hash: "hash-1",
        lastSavedHash: "",
        canAutoSave: true
      }).syncLastSavedHashToCurrent
    ).toBe(true);
  });

  it("clears dirty state when the current hash matches the saved draft", () => {
    expect(
      getDraftAutoSaveState({
        baselineHash: "hash-0",
        composeDraftId: "draft-1",
        composeDirty: true,
        previousDraftSaving: false,
        draftSaving: false,
        hash: "hash-1",
        lastSavedHash: "hash-1",
        canAutoSave: false
      })
    ).toEqual({
      initializeBaseline: false,
      syncLastSavedHashToCurrent: false,
      nextComposeDirty: false,
      shouldClearDirty: true,
      shouldScheduleSave: false
    });
  });

  it("schedules a save for dirty content with unsaved changes", () => {
    expect(
      getDraftAutoSaveState({
        baselineHash: "hash-0",
        composeDraftId: "draft-1",
        composeDirty: true,
        previousDraftSaving: false,
        draftSaving: false,
        hash: "hash-2",
        lastSavedHash: "hash-1",
        canAutoSave: true
      }).shouldScheduleSave
    ).toBe(true);
  });

  it("marks the draft dirty again when content changes during a save", () => {
    expect(
      getDraftAutoSaveState({
        baselineHash: "hash-0",
        composeDraftId: "draft-1",
        composeDirty: false,
        previousDraftSaving: true,
        draftSaving: false,
        hash: "hash-3",
        lastSavedHash: "hash-2",
        canAutoSave: true
      })
    ).toEqual({
      initializeBaseline: false,
      syncLastSavedHashToCurrent: false,
      nextComposeDirty: true,
      shouldClearDirty: false,
      shouldScheduleSave: true
    });
  });
});

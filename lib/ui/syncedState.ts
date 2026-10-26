import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local, editable copy of `source` that re-seeds whenever `source` changes.
 * The reset happens during render, so the component never paints a frame with
 * the previous copy after its source moved on.
 */
export function useSyncedState<T>(source: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(source);
  const [seededFrom, setSeededFrom] = useState(source);
  if (!Object.is(seededFrom, source)) {
    setSeededFrom(source);
    setValue(source);
  }
  return [value, setValue];
}

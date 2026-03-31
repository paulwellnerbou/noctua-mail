import type { Message } from "@/lib/data";

type ThreadFlatEntry = { message: Message; depth: number };

function getEffectiveThreadSortDate(message: Message) {
  const explicit = Number(message.threadSortDateValue);
  return Number.isFinite(explicit) ? explicit : message.dateValue;
}

function prefersCollapsedThreadRepresentative(candidate: Message, current: Message) {
  const candidateSortDate = getEffectiveThreadSortDate(candidate);
  const currentSortDate = getEffectiveThreadSortDate(current);
  if (candidateSortDate !== currentSortDate) {
    return candidateSortDate > currentSortDate;
  }

  // When the thread-level sort date is copied onto every message, prefer the
  // concrete message whose own date actually matches that effective thread date.
  const candidateMatchesSortDate = candidate.dateValue === candidateSortDate;
  const currentMatchesSortDate = current.dateValue === currentSortDate;
  if (candidateMatchesSortDate !== currentMatchesSortDate) {
    return candidateMatchesSortDate;
  }

  if (candidate.dateValue !== current.dateValue) {
    return candidate.dateValue > current.dateValue;
  }

  return candidate.id > current.id;
}

function getRepresentativeMessage(messages: Message[]) {
  if (messages.length === 0) return null;
  return messages.reduce((current, candidate) =>
    prefersCollapsedThreadRepresentative(candidate, current) ? candidate : current
  );
}

export function getCollapsedThreadRepresentativeMessage(params: {
  flat: ThreadFlatEntry[];
  target: Message;
  isFlaggedMessage?: (message: Message) => boolean;
  options?: { isFlaggedGroup?: boolean };
}) {
  const { flat, target, isFlaggedMessage, options } = params;
  const threadMessages = flat.map((item) => item.message);
  const flaggedMessages =
    options?.isFlaggedGroup && isFlaggedMessage
      ? threadMessages.filter((message) => isFlaggedMessage(message))
      : [];
  const fallbackTarget = flat.find((item) => item.message.id === target.id)?.message ?? flat[0]?.message ?? target;
  return getRepresentativeMessage(flaggedMessages) ?? getRepresentativeMessage(threadMessages) ?? fallbackTarget;
}

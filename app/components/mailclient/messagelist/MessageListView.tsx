import MessageCardList from "./MessageCardList";
import MessageTable from "./MessageTable";
import MessageThreadList from "./MessageThreadList";
import type { MessageListViewProps } from "./messageListViewTypes";

export default function MessageListView({
  view,
  state,
  actions,
  helpers,
  refs
}: MessageListViewProps) {
  if (view === "table") {
    return <MessageTable state={state} actions={actions} helpers={helpers} refs={refs} />;
  }

  if (view === "threads") {
    return <MessageThreadList state={state} actions={actions} helpers={helpers} refs={refs} />;
  }

  return (
    <MessageCardList
      state={{ ...state, isCompactView: view === "compact" }}
      actions={actions}
      helpers={helpers}
      refs={refs}
    />
  );
}

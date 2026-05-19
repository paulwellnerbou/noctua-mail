"use client";

import type { AccountDateFormat, Topic, TopicColor } from "@/lib/data";
import BuildRefreshDialog from "../BuildRefreshDialog";
import DeleteConfirmDialog from "../message/DeleteConfirmDialog";
import FullSyncConfirmDialog from "../message/FullSyncConfirmDialog";
import UnsubscribeConfirmDialog from "../message/UnsubscribeConfirmDialog";
import TopicPickerDialog from "../TopicPickerDialog";
import type { ConfirmDialogsView } from "./useConfirmDialogs";

type TopicPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTopics: Topic[];
  messageTopics: Topic[];
  suggestions: Topic[];
  onSave: (topicIds: string[]) => Promise<void>;
  onCreateTopic: (
    name: string,
    color: TopicColor | null,
    shortName?: string | null
  ) => Promise<Topic>;
};

type BuildRefreshProps = {
  buildVersion: string | null;
  onRefresh: () => void;
};

type Props = {
  confirm: ConfirmDialogsView;
  buildRefresh: BuildRefreshProps;
  topicPicker: TopicPickerProps;
  accountDateFormat?: AccountDateFormat;
};

/**
 * Renders the cluster of global overlay dialogs that were previously inlined
 * in MailClient's JSX: build-refresh prompt, the three promise-based
 * confirmation dialogs, and the topic picker. Purely presentational — state
 * lives in `useConfirmDialogs` (for the confirms) and in MailClient (for the
 * topic picker + build refresh).
 */
export default function DialogsHost({
  confirm,
  buildRefresh,
  topicPicker,
  accountDateFormat
}: Props) {
  return (
    <>
      <BuildRefreshDialog
        buildVersion={buildRefresh.buildVersion}
        onRefresh={buildRefresh.onRefresh}
      />
      <DeleteConfirmDialog
        deleteConfirm={confirm.deleteConfirm}
        onOpenChange={confirm.handleDeleteDialogOpenChange}
        resolveDeleteConfirm={confirm.resolveDeleteConfirm}
        accountDateFormat={accountDateFormat}
      />
      <FullSyncConfirmDialog
        confirmState={confirm.fullSyncConfirm}
        onOpenChange={confirm.handleFullSyncConfirmOpenChange}
        resolveConfirm={confirm.resolveFullSyncConfirm}
      />
      <UnsubscribeConfirmDialog
        unsubscribeConfirm={confirm.unsubscribeConfirm}
        onOpenChange={confirm.handleUnsubscribeDialogOpenChange}
        resolveUnsubscribeConfirm={confirm.resolveUnsubscribeConfirm}
      />
      <TopicPickerDialog
        open={topicPicker.open}
        onOpenChange={topicPicker.onOpenChange}
        allTopics={topicPicker.allTopics}
        messageTopics={topicPicker.messageTopics}
        suggestions={topicPicker.suggestions}
        onSave={topicPicker.onSave}
        onCreateTopic={topicPicker.onCreateTopic}
      />
    </>
  );
}

import { Button, Card, Flex, Text } from "@radix-ui/themes";
import type { AccountDateFormat, Message, Topic } from "@/lib/data";
import TopicBadge from "../TopicBadge";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import styles from "./TopicSuggestionPanel.module.css";

export type TopicSuggestionPanelItem = {
  message: Message;
  suggestionScore: number;
};

type TopicSuggestionPanelProps = {
  topic: Topic | null;
  suggestions: TopicSuggestionPanelItem[];
  isLoading?: boolean;
  pendingThreadIds?: ReadonlySet<string>;
  dateFormat?: AccountDateFormat;
  onOpenSuggestion: (message: Message) => void;
  onAddSuggestion: (item: TopicSuggestionPanelItem) => void;
};

export default function TopicSuggestionPanel({
  topic,
  suggestions,
  isLoading = false,
  pendingThreadIds,
  dateFormat,
  onOpenSuggestion,
  onAddSuggestion
}: TopicSuggestionPanelProps) {
  if (!topic) return null;
  if (!isLoading && suggestions.length === 0) return null;

  return (
    <Card size="1" className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <Flex align="center" gap="2" className={styles.eyebrow}>
            <Text size="1" color="gray">
              Suggested for
            </Text>
            <TopicBadge topic={topic} size="1" />
          </Flex>
          <Text size="1" color="gray" className={styles.description}>
            Inbox threads without a topic that look like a match.
          </Text>
        </div>
      </div>
      {isLoading && suggestions.length === 0 ? (
        <Text size="1" color="gray" className={styles.loadingText}>
          Finding matches…
        </Text>
      ) : (
        <div className={styles.list}>
          {suggestions.map((item) => {
            const threadId = item.message.threadId ?? item.message.id;
            const isPending = pendingThreadIds?.has(threadId) ?? false;
            const dateLabel = getMessageListDateDisplay(
              item.message.dateValue,
              item.message.date,
              dateFormat
            );

            return (
              <div key={item.message.id} className={styles.row}>
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => onOpenSuggestion(item.message)}
                  title={item.message.subject || "(no subject)"}
                >
                  <div className={styles.line}>
                    <span className={styles.subject}>{item.message.subject || "(no subject)"}</span>
                    <span className={styles.date} title={dateLabel.tooltip}>{dateLabel.text}</span>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.from}>{item.message.from}</span>
                    <span className={styles.score}>Score {item.suggestionScore}</span>
                  </div>
                  {item.message.preview ? (
                    <div className={styles.preview}>{item.message.preview}</div>
                  ) : null}
                </button>
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  className={styles.addButton}
                  disabled={isPending}
                  onClick={() => onAddSuggestion(item)}
                >
                  {isPending ? "Adding…" : "Add"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

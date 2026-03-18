import { useMemo, type CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Topic } from "@/lib/data";
import { topicColorToCssVar } from "@/lib/data";
import styles from "./FolderTree.module.css";
import topicStyles from "./TopicsSidebarSection.module.css";

type TopicsSidebarSectionProps = {
  topics: Topic[];
  topicMessageCountById?: ReadonlyMap<string, number>;
  activeTopicId: string | null;
  onTopicClick: (topicId: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export default function TopicsSidebarSection({
  topics,
  topicMessageCountById,
  activeTopicId,
  onTopicClick,
  collapsed = false,
  onToggleCollapsed
}: TopicsSidebarSectionProps) {
  const sidebarTopics = useMemo(() => {
    const items = [...topics];
    items.sort((a, b) => {
      const countDiff =
        (topicMessageCountById?.get(b.id) ?? 0) - (topicMessageCountById?.get(a.id) ?? 0);
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name);
    });
    return items;
  }, [topicMessageCountById, topics]);

  if (sidebarTopics.length === 0) return null;

  return (
    <div className={topicStyles.section}>
      <button
        type="button"
        className={`${styles.treeHeader} ${topicStyles.header} ${topicStyles.headerBtn}`}
        onClick={onToggleCollapsed}
        title={collapsed ? "Expand topics" : "Collapse topics"}
      >
        <span className={styles.panelTitle}>Topics</span>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      {!collapsed && sidebarTopics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          className={`${styles.treeRow} ${activeTopicId === topic.id ? styles.treeRowActive : ""}`}
          onClick={() => onTopicClick(topic.id)}
          title={topic.name}
        >
          <span
            className={topicStyles.colorDot}
            style={{ "--dot-color": topicColorToCssVar(topic.color) } as CSSProperties}
          />
          <span className={styles.treeName}>
            <span className={styles.treeNameText}>{topic.name}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

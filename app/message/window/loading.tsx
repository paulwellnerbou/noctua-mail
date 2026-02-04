import { Text } from "@radix-ui/themes";
import styles from "./page.module.css";

export default function MessageWindowLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.state}>
        <Text size="2" color="gray">
          Loading message window…
        </Text>
      </div>
    </div>
  );
}

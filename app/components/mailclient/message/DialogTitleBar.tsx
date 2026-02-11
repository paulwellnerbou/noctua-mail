import { X } from "lucide-react";
import { Dialog, Flex, IconButton } from "@radix-ui/themes";
import styles from "./DialogTitleBar.module.css";

type DialogTitleBarProps = {
  title: string;
  onClose: () => void;
};

export default function DialogTitleBar({ title, onClose }: DialogTitleBarProps) {
  return (
    <Flex align="center" justify="between" className={styles.header}>
      <Dialog.Title size="4">{title}</Dialog.Title>
      <IconButton variant="ghost" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </IconButton>
    </Flex>
  );
}

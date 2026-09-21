import { X } from "lucide-react";
import { Dialog, Flex } from "@radix-ui/themes";
import styles from "./DialogTitleBar.module.css";
import TooltipIconButton from "@/app/components/TooltipIconButton";

type DialogTitleBarProps = {
  title: string;
  onClose: () => void;
};

export default function DialogTitleBar({ title, onClose }: DialogTitleBarProps) {
  return (
    <Flex align="center" justify="between" className={styles.header}>
      <Dialog.Title size="4">{title}</Dialog.Title>
      <TooltipIconButton variant="ghost" tooltip="Close" onClick={onClose}>
        <X size={16} />
      </TooltipIconButton>
    </Flex>
  );
}

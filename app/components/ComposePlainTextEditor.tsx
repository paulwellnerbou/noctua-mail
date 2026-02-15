"use client";

import styles from "./ComposePlainTextEditor.module.css";

type ComposePlainTextEditorProps = {
  id?: string;
  name?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  resetKey?: number | string;
};

export default function ComposePlainTextEditor({
  id,
  name,
  defaultValue,
  onChange,
  textareaRef,
  resetKey,
}: ComposePlainTextEditorProps) {
  return (
    <textarea
      key={resetKey}
      id={id}
      name={name}
      ref={textareaRef}
      defaultValue={defaultValue}
      onChange={onChange}
      className={styles.textarea}
      spellCheck
    />
  );
}

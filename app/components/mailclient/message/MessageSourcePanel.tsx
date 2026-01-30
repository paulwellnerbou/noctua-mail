import SourcePanel from "./SourcePanel";

type MessageSourcePanelProps = {
  messageId: string;
  fetchSource: (messageId: string) => Promise<string | null>;
  scrubSource: (source?: string) => string;
};

export default function MessageSourcePanel({
  messageId,
  fetchSource,
  scrubSource
}: MessageSourcePanelProps) {
  return <SourcePanel messageId={messageId} fetchSource={fetchSource} scrubSource={scrubSource} />;
}

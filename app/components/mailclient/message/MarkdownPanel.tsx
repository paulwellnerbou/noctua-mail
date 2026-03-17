import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { normalizeMarkdownBody } from "./normalizeMarkdownBody";
import { useMessageLinkPreview } from "./MessageLinkPreviewContext";

type MarkdownPanelProps = {
  body?: string;
  fontScale?: number;
};

export default function MarkdownPanel({ body, fontScale = 1 }: MarkdownPanelProps) {
  const setLinkPreviewUrl = useMessageLinkPreview();

  useEffect(() => () => setLinkPreviewUrl(null), [setLinkPreviewUrl]);

  return (
    <div
      className="markdown-view"
      style={{
        fontSize: `${15 * fontScale}px`
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node, href, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer"
              onMouseEnter={(event) => {
                setLinkPreviewUrl(event.currentTarget.href || href || null);
              }}
              onMouseLeave={() => {
                setLinkPreviewUrl(null);
              }}
              onFocus={(event) => {
                setLinkPreviewUrl(event.currentTarget.href || href || null);
              }}
              onBlur={() => {
                setLinkPreviewUrl(null);
              }}
            />
          )
        }}
      >
        {normalizeMarkdownBody(body ?? "")}
      </ReactMarkdown>
    </div>
  );
}

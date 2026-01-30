import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type MarkdownPanelProps = {
  body?: string;
  fontScale?: number;
};

export default function MarkdownPanel({ body, fontScale = 1 }: MarkdownPanelProps) {
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
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />
        }}
      >
        {(body ?? "").replace(/\*([^*\n]+)\*(?=[A-Za-z0-9ÄÖÜäöü])/g, "*$1* ")}
      </ReactMarkdown>
    </div>
  );
}

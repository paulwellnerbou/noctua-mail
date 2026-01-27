import { groupQuoteBlocks, parseQuotedLines } from "@/lib/quote";

export default function QuoteRenderer({ body }: { body: string }) {
  const blocks = groupQuoteBlocks(parseQuotedLines(body));
  const linkify = (text: string) => {
    const parts = text.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, index) => {
      if (part.match(/^https?:\/\//)) {
        return (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const renderLine = (line: string, key: string) => (
    <span key={key} className="text-line">
      {line ? linkify(line) : <span>&nbsp;</span>}
      <br />
    </span>
  );

  return (
    <div>
      {blocks.map((block, index) => {
        if (block.level === 0) {
          return (
            <div key={index}>
              {block.lines.map((line, lineIndex) =>
                renderLine(line, `${index}-${lineIndex}`)
              )}
            </div>
          );
        }

        const levelClass = block.level >= 3 ? "quote-level-3" : block.level === 2 ? "quote-level-2" : "";

        return (
          <div key={index} className={`quote-block ${levelClass}`}>
            {block.lines.map((line, lineIndex) =>
              renderLine(line, `${index}-${lineIndex}`)
            )}
          </div>
        );
      })}
    </div>
  );
}

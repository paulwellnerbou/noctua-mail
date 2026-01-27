import type React from "react";
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

        const content = (
          <div key={`content-${index}`}>
            {block.lines.map((line, lineIndex) =>
              renderLine(line, `${index}-${lineIndex}`)
            )}
          </div>
        );
        const wrapped = Array.from({ length: block.level }).reduceRight(
          (child, _, depthIndex) => {
            const level = block.level - depthIndex;
            const levelClass =
              level >= 3 ? "quote-level-3" : level === 2 ? "quote-level-2" : "";
            return (
              <div key={`quote-${index}-${level}`} className={`quote-block ${levelClass}`}>
                {child}
              </div>
            );
          },
          content as React.ReactNode
        );
        return <div key={`block-${index}`}>{wrapped}</div>;
      })}
    </div>
  );
}

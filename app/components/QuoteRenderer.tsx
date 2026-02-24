import type React from "react";
import { groupQuoteBlocks, parseQuotedLines } from "@/lib/quote";
import { linkifyText } from "@/app/components/LinkifiedText";

export default function QuoteRenderer({ body }: { body: string }) {
  const blocks = groupQuoteBlocks(parseQuotedLines(body));

  const renderLine = (line: string, key: string) => (
    <span key={key} className="text-line">
      {line ? linkifyText(line) : <span>&nbsp;</span>}
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
        const wrapped = Array.from({ length: block.level }).reduceRight<React.ReactNode>(
          (child, _, depthIndex) => {
            // reduceRight builds from inner-most child outward, so depth index maps
            // directly to visual nesting level (outer = 1, next = 2, ...).
            const level = depthIndex + 1;
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

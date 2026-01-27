export type QuoteLine = {
  level: number;
  text: string;
};

export function parseQuotedLines(body: string): QuoteLine[] {
  return body.split("\n").map((line) => {
    const match = line.match(/^(>+)?\s*(.*)$/);
    const markers = match?.[1] ?? "";
    return {
      level: markers.length,
      text: match?.[2] ?? line
    };
  });
}

export function groupQuoteBlocks(lines: QuoteLine[]) {
  const blocks: { level: number; lines: string[] }[] = [];

  lines.forEach((line) => {
    const last = blocks[blocks.length - 1];
    if (!last || last.level !== line.level) {
      blocks.push({ level: line.level, lines: [line.text] });
    } else {
      last.lines.push(line.text);
    }
  });

  return blocks;
}

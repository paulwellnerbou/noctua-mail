declare module "mailparser" {
  export type SimpleParserOptions = {
    skipHtmlToText?: boolean;
    skipTextToHtml?: boolean;
    [key: string]: unknown;
  };

  export function simpleParser(
    input: Buffer | string,
    options?: SimpleParserOptions
  ): Promise<any>;
}

declare module "mammoth/mammoth.browser" {
  interface ConvertResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  interface ConvertOptions {
    arrayBuffer?: ArrayBuffer;
    styleMap?: string | string[];
  }
  const mammoth: {
    convertToHtml(options: ConvertOptions): Promise<ConvertResult>;
    extractRawText(options: ConvertOptions): Promise<ConvertResult>;
  };
  export default mammoth;
}

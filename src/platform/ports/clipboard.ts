/** System clipboard access for text and native attachments. */
export interface ClipboardPort {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
  /** Capability probe; unsupported content never appears as a menu action. */
  canCopyAttachment(mime?: string): boolean;
  /** Copy local content, rejecting if the clipboard cannot accept it. */
  copyAttachment(uri: string, options?: { mimeType?: string; name?: string }): Promise<void>;
}

/** Native attachment clipboard support. Text uses the existing safe wrapper. */
export interface ClipboardPort {
  /** Capability probe; unsupported content never appears as a menu action. */
  canCopyAttachment(mime?: string): boolean;
  /** Copy local content, rejecting if the clipboard cannot accept it. */
  copyAttachment(uri: string, options?: { mimeType?: string; name?: string }): Promise<void>;
}

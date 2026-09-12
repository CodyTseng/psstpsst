/** The payload needed to resend one stored message to another conversation. */
export type ForwardMessage = {
  kind: number;
  content: string;
  /** The original rumor tags; routing tags are removed at send time. */
  tags: string[][];
};

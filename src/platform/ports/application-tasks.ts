/** Independent Android document tasks share the trusted JS host, not page authority. */
export interface ApplicationTasksPort {
  open(id: string, title: string): Promise<void>;
  focus(id: string): Promise<void>;
  close(id: string): Promise<void>;
  showHost(): Promise<void>;
  active(): string | null;
  onActive(listener: (id: string | null) => void): () => void;
  onClosed(listener: (id: string) => void): () => void;
}

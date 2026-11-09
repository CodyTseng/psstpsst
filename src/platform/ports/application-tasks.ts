export type ApplicationTaskDrawerOptions = {
  viewTag: number; handleTag: number;
  travel: number; margin: number; feedbackColor: number;
  active: boolean; expanded: boolean;
};

/** Independent Android document tasks share the trusted JS host, not page authority. */
export interface ApplicationTasksPort {
  open(id: string, title: string): Promise<void>;
  focus(id: string): Promise<void>;
  close(id: string): Promise<void>;
  showHost(): Promise<void>;
  /** Native task chrome owns direct manipulation without per-frame JS callbacks. */
  configureDrawer(id: string, options: ApplicationTaskDrawerOptions): Promise<void>;
  releaseDrawer(id: string, viewTag: number): Promise<void>;
  onDrawerChange(listener: (id: string, expanded: boolean, offsetY: number) => void): () => void;
  active(): string | null;
  onActive(listener: (id: string | null) => void): () => void;
  onClosed(listener: (id: string) => void): () => void;
}

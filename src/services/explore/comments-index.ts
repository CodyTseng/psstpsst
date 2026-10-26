import type { ApplicationComment } from './comments-protocol';

export type CommentRow = {
  comment: ApplicationComment; depth: number; hasReplies: boolean;
  guideDepths: number[]; parentDepth?: number; continuesParent: boolean;
};
export const MAX_THREAD_COMMENTS = 500;

/** Incremental ordering keeps live arrivals from re-sorting the whole discussion. */
export class CommentIndex {
  private comments = new Map<string, ApplicationComment>();
  private ordered: string[] = [];
  private children = new Map<string, string[]>();
  get size() { return this.comments.size; }
  get(id: string) { return this.comments.get(id); }
  private compare(a: string, b: string) {
    const first = this.comments.get(a)!.event, second = this.comments.get(b)!.event;
    return second.created_at - first.created_at || first.id.localeCompare(second.id);
  }
  private insert(list: string[], id: string, ascending = false) {
    let low = 0, high = list.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const comparison = this.compare(id, list[middle]) * (ascending ? -1 : 1);
      if (comparison < 0) high = middle; else low = middle + 1;
    }
    list.splice(low, 0, id);
  }
  private validParent(comment: ApplicationComment, parent: ApplicationComment): boolean {
    const reference = comment.event.tags.find(tag => tag[0] === 'e');
    return comment.event.tags.some(tag => tag[0] === 'p' && tag[1] === parent.event.pubkey) &&
      (!reference?.[3] || reference[3] === parent.event.pubkey);
  }
  private remove(id: string) {
    const parent = this.comments.get(id)?.parentId;
    this.comments.delete(id);
    const index = this.ordered.indexOf(id);
    if (index >= 0) this.ordered.splice(index, 1);
    if (parent) {
      const siblings = this.children.get(parent)!;
      siblings.splice(siblings.indexOf(id), 1);
      if (!siblings.length) this.children.delete(parent);
    }
  }
  add(comment: ApplicationComment): boolean {
    const id = comment.event.id;
    if (this.comments.has(id)) return false;
    const parent = comment.parentId ? this.comments.get(comment.parentId) : undefined;
    if (parent && !this.validParent(comment, parent)) return false;
    this.comments.set(id, comment); this.insert(this.ordered, id);
    for (const child of [...(this.children.get(id) ?? [])]) {
      const reply = this.comments.get(child);
      if (reply && !this.validParent(reply, comment)) this.remove(child);
    }
    if (comment.parentId) {
      const children = this.children.get(comment.parentId) ?? [];
      this.insert(children, id, true); this.children.set(comment.parentId, children);
    }
    if (this.comments.size > MAX_THREAD_COMMENTS) {
      this.remove(this.ordered[this.ordered.length - 1]);
    }
    return this.comments.has(id);
  }
  rows(): CommentRow[] {
    const rows: CommentRow[] = [], visited = new Set<string>();
    const visit = (id: string, depth: number, guideDepths: number[] = [], parentDepth?: number, continuesParent = false) => {
      if (visited.has(id)) return;
      const comment = this.comments.get(id);
      if (!comment) return;
      visited.add(id);
      const children = (this.children.get(id) ?? []).filter(child => this.comments.has(child) && !visited.has(child));
      rows.push({ comment, depth: Math.min(depth, 3), hasReplies: depth < 3 && children.length > 0,
        guideDepths, parentDepth, continuesParent });
      const childGuides = continuesParent && parentDepth !== undefined ? [...guideDepths, parentDepth] : guideDepths;
      children.forEach((child, i) => visit(child, depth + 1, childGuides, depth < 3 ? depth : undefined, i < children.length - 1));
    };
    for (const id of this.ordered) {
      const parent = this.comments.get(id)?.parentId;
      if (!parent || !this.comments.has(parent)) visit(id, 0);
    }
    // Missing ancestors and hostile cycles must not hide otherwise valid content.
    for (const id of this.ordered) visit(id, 0);
    return rows;
  }
}

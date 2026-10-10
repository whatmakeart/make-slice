/** Small, bounded snapshots of committed parameters; meshes stay outside history. */
export class ParameterHistory<T> {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private readonly limit = 25) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  push(current: T, next: T): boolean {
    const snapshot = JSON.stringify(current);
    if (snapshot === JSON.stringify(next)) return false;
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: T): T | null {
    if (!this.canUndo) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop()!);
  }
  redo(current: T): T | null {
    if (!this.canRedo) return null;
    this.past.push(JSON.stringify(current));
    if (this.past.length > this.limit) this.past.shift();
    return JSON.parse(this.future.pop()!);
  }
  clear() { this.past = []; this.future = []; }
}

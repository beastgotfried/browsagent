import type {
  ElementRecord,
  RuntimeRecord,
  StaticStamp,
  Task,
} from '@browsagent/shared';

interface Entry {
  stamp: StaticStamp;
  record: RuntimeRecord | null;
}

/** The index of all nodes with a stamp. */
export class Index {
  private readonly entries = new Map<string, Entry>();

  setStamps(stamps: StaticStamp[]): void {
    for (const stamp of stamps) {
      const old = this.entries.get(stamp.inst);
      this.entries.set(stamp.inst, { stamp, record: old?.record ?? null });
    }
  }

  setRecords(records: RuntimeRecord[]): void {
    for (const record of records) {
      const old = this.entries.get(record.inst);
      if (!old) continue;
      this.entries.set(record.inst, { stamp: old.stamp, record });
    }
  }

  get(inst: string): Entry | null {
    return this.entries.get(inst) ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The list of all tasks. */
export class TaskStore {
  private readonly tasks = new Map<string, Task>();

  put(task: Task): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): Task | null {
    return this.tasks.get(id) ?? null;
  }

  all(): Task[] {
    return [...this.tasks.values()];
  }
}

export type { ElementRecord };

import { expect } from "vitest";
import type { ShellTimerHost } from "../../src/main/lifecycle/shell";

interface ArmedTimer {
  ms: number;
  fire: () => void;
}

/** Deterministic ShellTimerHost: armed timers fire only when told to. */
export class FakeTimers implements ShellTimerHost {
  private next = 0;
  readonly armed = new Map<number, ArmedTimer>();

  set(ms: number, fire: () => void): unknown {
    const handle = ++this.next;
    this.armed.set(handle, { ms, fire });
    return handle;
  }

  clear(handle: unknown): void {
    this.armed.delete(handle as number);
  }

  armedDurations(): number[] {
    return [...this.armed.values()].map((timer) => timer.ms);
  }

  /** Fire the single armed timer; fails the test if the count is not one. */
  fireOnly(): void {
    const timers = [...this.armed.entries()];
    expect(timers).toHaveLength(1);
    this.fireHandle(timers[0][0]);
  }

  /** Fire the single armed timer with the given duration. */
  fire(ms: number): void {
    const matches = [...this.armed.entries()].filter(
      ([, timer]) => timer.ms === ms,
    );
    expect(matches).toHaveLength(1);
    this.fireHandle(matches[0][0]);
  }

  private fireHandle(handle: number): void {
    const timer = this.armed.get(handle);
    this.armed.delete(handle);
    timer?.fire();
  }
}

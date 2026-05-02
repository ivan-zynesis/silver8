import { Injectable } from '@nestjs/common';

/**
 * Aggregates readiness signals from each subsystem (ingestion, gateway, mcp).
 * /readyz reports ready=true only when every registered component reports ready.
 *
 * On SIGTERM the shutdown service calls `markDraining()` which immediately flips
 * /readyz to not-ready so the LB stops sending new connections (DEC-019, DEC-020).
 */
@Injectable()
export class ReadinessService {
  private readonly states = new Map<string, boolean>();
  private draining = false;

  declare(component: string, initial = false): void {
    if (!this.states.has(component)) {
      this.states.set(component, initial);
    }
  }

  set(component: string, ready: boolean): void {
    this.states.set(component, ready);
  }

  markDraining(): void {
    this.draining = true;
  }

  isReady(): boolean {
    if (this.draining) return false;
    if (this.states.size === 0) return true; // no components declared yet (e.g. very early bootstrap)
    for (const ready of this.states.values()) {
      if (!ready) return false;
    }
    return true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  details(): Array<{ component: string; ready: boolean }> {
    return Array.from(this.states, ([component, ready]) => ({ component, ready }));
  }
}

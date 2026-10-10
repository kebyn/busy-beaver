import { execFileSync } from "node:child_process";

export const reference = JSON.parse(execFileSync("uv", ["run", "python", "-m", "tests.frontend.reference"], {
  cwd: new URL("../../", import.meta.url), maxBuffer: 64 * 1024 * 1024, encoding: "utf8",
}));

export class FakeClock {
  time = 0;
  nextId = 0;
  timers = new Map();
  now = () => this.time;
  setTimeout = (fn, delay) => {
    const id = ++this.nextId;
    this.timers.set(id, { fn, at: this.time + delay });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.time = Math.max(this.time, next[1].at);
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.time = Math.max(this.time, end);
  }
}

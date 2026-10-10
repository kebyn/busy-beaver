export const TRACE_LIMIT = 200;

// Execution state is independent of the bounded trace. Reuse ring entries so
// long runs do not allocate a new object on every transition.
export class Simulator {
  constructor(machine) {
    if (!machine || typeof machine.start_state !== "string" || !machine.transitions) {
      throw new Error("机器缺少初始状态或转移表。");
    }
    this.machine = machine;
    this.state = machine.start_state;
    this.head = 0;
    this.steps = 0;
    this.tape = new Set();
    this.history = Array.from({ length: TRACE_LIMIT }, () => ({}));
    this.error = null;
  }

  get halted() { return this.state === "H"; }

  step() {
    if (this.halted || this.error) return false;
    const read = this.tape.has(this.head) ? 1 : 0;
    const rule = this.machine.transitions[this.state]?.[read];
    if (!rule) throw new Error(`缺少转移：状态 ${this.state}，读取 ${read}。`);
    if ((rule.write !== 0 && rule.write !== 1) ||
        !["L", "R"].includes(rule.direction) ||
        typeof rule.next_state !== "string" ||
        (rule.next_state !== "H" && !Object.hasOwn(this.machine.transitions, rule.next_state))) {
      throw new Error(`无效转移：状态 ${this.state}，读取 ${read}。`);
    }
    const nextHead = this.head + (rule.direction === "R" ? 1 : -1);
    const entry = this.history[this.steps % TRACE_LIMIT];
    entry.step = this.steps + 1;
    entry.state = this.state;
    entry.position = this.head;
    entry.read = read;
    entry.write = rule.write;
    entry.direction = rule.direction;
    entry.next_state = rule.next_state;
    entry.next_position = nextHead;
    if (rule.write) this.tape.add(this.head);
    else this.tape.delete(this.head);
    this.head = nextHead;
    this.state = rule.next_state;
    this.steps++;
    return true;
  }

  snapshot() {
    const trace = [];
    for (let i = Math.max(0, this.steps - TRACE_LIMIT); i < this.steps; i++) {
      trace.push({ ...this.history[i % TRACE_LIMIT] });
    }
    const tapeWindow = [];
    for (let position = this.head - 12; position <= this.head + 12; position++) {
      tapeWindow.push({ position, value: this.tape.has(position) ? 1 : 0 });
    }
    return {
      machine: this.machine.id, state: this.halted ? "HALT" : this.state,
      steps_executed: this.steps, head_position: this.head, ones: this.tape.size,
      halted: this.halted, error: this.error, tape_window: tapeWindow, trace,
    };
  }
}

// Production and tests share the scheduler; tests inject a virtual clock.
export class Runner {
  constructor(emit, clock = {
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  }) {
    this.emit = emit;
    this.clock = clock;
    this.timer = null;
    this.runId = 0;
    this.commandId = 0;
    this.sequence = 0;
    this.sim = null;
  }

  cancel() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  configure(settings) {
    if (!Number.isInteger(settings.maxSteps) || settings.maxSteps < 0 || settings.maxSteps > 1_000_000) {
      throw new Error("最大步数必须是 0 到 1,000,000 之间的整数。");
    }
    if (!Number.isInteger(settings.interval) || settings.interval < 50 || settings.interval > 2000) {
      throw new Error("固定速度必须在每步 50 到 2,000 毫秒之间。");
    }
    this.settings = { ...settings };
  }

  stoppedStatus(fallback = "paused") {
    if (this.sim.error) return "error";
    if (this.sim.halted) return "halted";
    if (this.sim.steps >= this.settings.maxSteps) return "limit";
    return fallback;
  }

  publish() {
    this.emit({ type: "snapshot", runId: this.runId, commandId: this.commandId,
      sequence: ++this.sequence, status: this.status, limit: this.settings.maxSteps,
      ...this.sim.snapshot() });
  }

  fail(error) {
    this.cancel();
    if (this.sim && this.settings) {
      this.sim.error = error.message;
      this.status = "error";
      this.publish();
    } else {
      this.emit({ type: "failure", runId: this.runId, commandId: this.commandId, error: error.message });
    }
  }

  handle(message) {
    const { type, runId, commandId } = message;
    if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(commandId)) return;
    if (type === "init") {
      if (runId <= this.runId) return;
      this.cancel();
      this.runId = runId;
      this.commandId = commandId;
      this.sequence = 0;
      this.sim = null;
      try {
        this.configure(message.settings);
        this.sim = new Simulator(message.machine);
        this.status = this.stoppedStatus("idle");
        this.publish();
      } catch (error) { this.fail(error); }
      return;
    }
    if (runId !== this.runId || commandId <= this.commandId || !this.sim) return;
    this.commandId = commandId;
    try {
      if (type === "configure") {
        this.cancel();
        this.configure(message.settings);
        this.status = this.stoppedStatus(this.sim.steps ? "paused" : "idle");
      } else if (type === "pause" || type === "step") {
        this.cancel();
        this.status = this.stoppedStatus();
        if (type === "step" && this.status === "paused") {
          this.sim.step();
          this.status = this.stoppedStatus();
        }
      } else if (type === "run") {
        this.status = this.stoppedStatus("running");
        if (this.status === "running" && this.timer === null) this.schedule();
      }
      this.publish();
    } catch (error) { this.fail(error); }
  }

  schedule() {
    this.timer = this.clock.setTimeout(() => this.tick(), this.settings.interval);
  }

  tick() {
    this.timer = null;
    if (this.status !== "running") return;
    try {
      this.sim.step();
      this.status = this.stoppedStatus("running");
      this.publish();
      if (this.status === "running") this.schedule();
    } catch (error) { this.fail(error); }
  }
}

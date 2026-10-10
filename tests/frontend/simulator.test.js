import test from "node:test";
import assert from "node:assert/strict";
import { Simulator, Runner } from "../../static/simulator.js";
import { reference, FakeClock } from "./helpers.js";

for (const [id, machine] of Object.entries(reference.machines)) {
  test(`${id}: every transition matches Python, including the tape and trace`, () => {
    const sim = new Simulator(machine);
    for (const expected of reference.snapshots[id]) {
      while (sim.steps < expected.steps_executed) sim.step();
      const actual = sim.snapshot();
      for (const field of ["machine", "state", "steps_executed", "head_position", "ones", "halted", "trace"]) {
        assert.deepEqual(actual[field], expected[field], `${field} at ${sim.steps}`);
      }
      assert.deepEqual(Object.fromEntries([...sim.tape].map((p) => [p, 1])), expected.tape);
      assert.deepEqual(Object.fromEntries(actual.tape_window.map((c) => [c.position, c.value])), expected.tape_window);
      assert.equal(actual.tape_window.length, 25);
      assert.equal(actual.tape_window[0].position, sim.head - 12);
      assert.ok(actual.trace.length <= 200);
    }
    if (sim.halted) assert.equal(sim.step(), false);
  });
}

function setup(machine = reference.machines.busy_beaver_3, maxSteps = 1000) {
  const clock = new FakeClock();
  const frames = [];
  const runner = new Runner((frame) => frames.push(frame), clock);
  let commandId = 0;
  const send = (type, extra = {}) => runner.handle({ type, runId: 1, commandId: ++commandId, ...extra });
  send("init", { machine, settings: { maxSteps, interval: 1000, speedMode: "fixed" } });
  return { runner, frames, clock, send, last: () => frames.at(-1) };
}

test("consecutive steps, step during playback, pause, resume, and halt", () => {
  const { send, last, clock } = setup();
  assert.equal(last().status, "idle");
  assert.equal(last().ones, 0);
  send("step"); send("step");
  assert.equal(last().steps_executed, 2);
  send("run");
  clock.advance(999);
  assert.equal(last().steps_executed, 2);
  clock.advance(1);
  assert.equal(last().steps_executed, 3);
  send("step");
  assert.equal(last().steps_executed, 4);
  assert.equal(last().status, "paused");
  clock.advance(5000);
  assert.equal(last().steps_executed, 4);
  send("run"); clock.advance(1000); send("pause");
  assert.equal(last().steps_executed, 5);
  send("step");
  assert.equal(last().steps_executed, 6);
  send("run"); clock.advance(10000);
  assert.equal(last().status, "halted");
  assert.equal(last().steps_executed, 14);
  send("run"); send("step"); clock.advance(5000);
  assert.equal(last().steps_executed, 14);
});

test("limits pause in place, can be raised, and never undo the tape", () => {
  const { send, last, clock } = setup(undefined, 2);
  send("run"); clock.advance(2000);
  assert.equal(last().status, "limit");
  assert.equal(last().halted, false);
  send("configure", { settings: { maxSteps: 1, interval: 50, speedMode: "fixed" } });
  send("step");
  assert.equal(last().steps_executed, 2);
  send("configure", { settings: { maxSteps: 14, interval: 50, speedMode: "fixed" } });
  assert.equal(last().status, "paused");
  send("run"); clock.advance(600);
  assert.equal(last().status, "halted");
  const zero = setup(undefined, 0);
  zero.send("run"); zero.send("step");
  assert.equal(zero.last().steps_executed, 0);
  assert.equal(zero.last().status, "limit");
});

test("reset/switch starts blank and rejects stale commands and timers", () => {
  const { send, last, clock } = setup();
  send("run"); clock.advance(3000);
  send("init", { runId: 2, machine: reference.machines.busy_beaver_2, settings: { maxSteps: 1000, interval: 1000 } });
  send("run"); send("step"); clock.advance(10000);
  assert.equal(last().runId, 2);
  assert.equal(last().machine, "busy_beaver_2");
  assert.equal(last().steps_executed, 0);
  assert.equal(last().ones, 0);
  assert.equal(last().state, "A");
});

test("bad transitions stop before mutating the tape", () => {
  for (const rule of [null, { write: 2, direction: "R", next_state: "A" },
    { write: 1, direction: "bad", next_state: "A" }, { write: 1, direction: "R", next_state: "unknown" }]) {
    const machine = { id: "bad", start_state: "A", transitions: { A: rule ? { 0: rule } : {} } };
    const { send, last, clock } = setup(machine);
    send("run"); clock.advance(1000);
    assert.equal(last().status, "error");
    assert.equal(last().steps_executed, 0);
    assert.equal(last().ones, 0);
    assert.match(last().error, /转移/);
    send("step");
    assert.equal(last().steps_executed, 0);
  }
});

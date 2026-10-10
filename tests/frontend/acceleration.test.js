import test from "node:test";
import assert from "node:assert/strict";
import { Runner, HALT_GUARD_STEPS, stepDelay } from "../../static/simulator.js";
import { reference, FakeClock } from "./helpers.js";

function setup(id, settings = {}) {
  const clock = new FakeClock();
  const frames = [];
  const runner = new Runner((frame) => frames.push({ ...frame, time: clock.time }), clock);
  let commandId = 0;
  const send = (type, extra = {}) => runner.handle({ runId: 1, commandId: ++commandId, type, ...extra });
  send("init", { machine: reference.machines[id], settings: { maxSteps: 200, interval: 1000, ...settings } });
  return { clock, runner, frames, send, last: () => frames.at(-1) };
}

test("2/3-state auto mode stays at one transition per second", () => {
  for (const [count, steps, ones] of [[2, 6, 4], [3, 14, 6]]) {
    const { clock, send, last } = setup(`busy_beaver_${count}`);
    send("run");
    clock.advance(steps * 1000 - 1);
    assert.equal(last().steps_executed, steps - 1);
    clock.advance(1);
    assert.equal(last().steps_executed, steps);
    assert.equal(last().ones, ones);
    assert.equal(last().status, "halted");
  }
});

test("4/5-state auto cadence: steps 1–5 at 1000 ms, 6–100 at 50 ms, then fast", () => {
  for (const count of [4, 5]) {
    const { clock, send, last, frames } = setup(`busy_beaver_${count}`);
    send("run");
    clock.advance(4999);
    assert.equal(last().steps_executed, 4);
    clock.advance(1);
    assert.equal(last().steps_executed, 5);
    clock.advance(49);
    assert.equal(last().steps_executed, 5);
    clock.advance(1);
    assert.equal(last().steps_executed, 6);
    clock.advance(4699);
    assert.equal(last().steps_executed, 99);
    clock.advance(1);
    assert.equal(frames.find((frame) => frame.steps_executed === 100).time, 9750);
    assert.equal(last().steps_executed, count === 4 ? 107 : 200);
    assert.equal(last().status, count === 4 ? "halted" : "limit");
    if (count === 4) assert.equal(last().ones, 13);
  }
});

test("fixed speed applies beyond step 200; changing it pauses and preserves progress", () => {
  const { clock, send, last } = setup("busy_beaver_5", { maxSteps: 1000, speedMode: "fixed", interval: 50 });
  send("run"); clock.advance(10050);
  assert.equal(last().steps_executed, 201);
  assert.equal(last().trace.length, 200);
  send("configure", { settings: { maxSteps: 1000, speedMode: "fixed", interval: 2000 } });
  clock.advance(5000);
  assert.equal(last().steps_executed, 201);
  assert.equal(last().status, "paused");
  send("run"); clock.advance(1999);
  assert.equal(last().steps_executed, 201);
  clock.advance(1);
  assert.equal(last().steps_executed, 202);
  for (const count of [2, 3, 4, 5]) {
    assert.equal(stepDelay(count, 10000, { speedMode: "fixed", interval: 2000 }), 2000);
  }
});

test("live speed changes reschedule once and preserve running or paused state", () => {
  const { clock, send, last } = setup("busy_beaver_5", { speedMode: "fixed", interval: 2000 });
  send("run"); clock.advance(1000);
  send("speed", { settings: { speedMode: "fixed", interval: 50 } });
  assert.equal(last().status, "running");
  clock.advance(49);
  assert.equal(last().steps_executed, 0);
  clock.advance(1);
  assert.equal(last().steps_executed, 1);
  send("pause");
  send("speed", { settings: { speedMode: "auto", interval: 1000 } });
  clock.advance(5000);
  assert.equal(last().steps_executed, 1);
  assert.equal(last().status, "paused");
});

test("fast batches yield at 10 ms, refresh at 100 ms, and process pause/step/resume", () => {
  const { clock, send, last, runner, frames } = setup("busy_beaver_5", { executionMode: "until-halt" });
  for (let i = 0; i < 100; i++) send("step");
  const realStep = runner.sim.step.bind(runner.sim);
  runner.sim.step = () => { clock.time += 1; return realStep(); };
  send("run");
  const initialFrames = frames.length;
  clock.advance(0); // One 10 ms batch returns control.
  assert.equal(runner.sim.steps, 110);
  assert.equal(frames.length, initialFrames);
  clock.advance(80);
  assert.equal(last().steps_executed, 200);
  assert.equal(last().time, 100);
  assert.equal(last().stepsPerSecond, 1000);
  send("pause");
  const paused = last().steps_executed;
  clock.advance(1000);
  assert.equal(last().steps_executed, paused);
  send("step");
  assert.equal(last().steps_executed, paused + 1);
  send("run"); clock.advance(0); send("pause");
  assert.equal(last().steps_executed, paused + 11);
});

test("50M guard is independent of the server cap and does not claim a halt", () => {
  const { send, last, runner } = setup("busy_beaver_5", { executionMode: "until-halt" });
  assert.equal(last().limit, HALT_GUARD_STEPS);
  // Exercise the exact boundary without spending 50M steps on a nonhalting test machine.
  runner.sim.machine = { id: "loop", state_count: 5, transitions: { A: { 0: { write: 0, direction: "R", next_state: "A" } } } };
  runner.sim.steps = HALT_GUARD_STEPS - 1;
  send("step");
  assert.equal(last().steps_executed, HALT_GUARD_STEPS);
  assert.equal(last().status, "limit");
  assert.equal(last().halted, false);
  send("step");
  assert.equal(last().steps_executed, HALT_GUARD_STEPS);
  send("configure", { settings: { executionMode: "limited", maxSteps: 1000, interval: 1000 } });
  assert.equal(last().limit, 1000);
  assert.equal(last().steps_executed, HALT_GUARD_STEPS);
});

test("invalid settings are rejected, including attempts to exceed the limited-mode cap", () => {
  for (const settings of [{ maxSteps: 1_000_001 }, { maxSteps: -1 }, { interval: 49 },
    { interval: 2001 }, { executionMode: "unknown" }, { speedMode: "unknown" }]) {
    const { last } = setup("busy_beaver_5", settings);
    assert.equal(last().type, "failure");
    assert.ok(last().error);
  }
});

test("complete five-state execution through the real batch scheduler: 47,176,870 / 4,098", { timeout: 120000 }, async () => {
  const start = performance.now();
  const final = await new Promise((resolve, reject) => {
    const runner = new Runner((frame) => {
      if (frame.status === "halted") resolve(frame);
      else if (frame.status === "error" || frame.type === "failure") reject(new Error(frame.error));
    });
    let commandId = 0;
    const send = (type, extra = {}) => runner.handle({ type, runId: 1, commandId: ++commandId, ...extra });
    send("init", { machine: reference.machines.busy_beaver_5,
      settings: { maxSteps: 1000, interval: 1000, executionMode: "until-halt" } });
    for (let i = 0; i < 100; i++) send("step");
    send("run");
  });
  assert.equal(final.steps_executed, 47_176_870);
  assert.equal(final.ones, 4098);
  assert.equal(final.state, "HALT");
  assert.equal(final.trace.length, 200);
  assert.equal(final.trace[0].step, 47_176_671);
  assert.equal(final.trace.at(-1).next_state, "H");
  console.log(`Node full execution (100 manual opening steps): ${(performance.now() - start).toFixed(0)} ms`);
});

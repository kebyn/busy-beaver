[English](verification.md) | [简体中文](verification.zh-CN.md)

# Verification Record: Single Stepping and Automatic Acceleration

Verification date: 2026-10-10. The following is a historical record of results measured on that date.

## Environment

- Debian GNU/Linux 13 in an x86_64 container; AMD EPYC 9475F CPU, with `nproc` reporting 6 available CPUs.
- Node.js 24.21.0, uv 0.12.24, and Playwright 1.64.0.
- Chromium 156.0.8078.4; headed tests ran through Xvfb with page visibility reported as `visible` and a 1280 × 1000 viewport.
- A single browser test process; no other simulation tests ran in parallel during performance measurements.

## Automated Results

| Check | Result |
| --- | --- |
| `uv run python -m unittest discover -v` | All 6 existing tests passed |
| `npm test` | 16 frontend core tests passed, including controllable-clock tests and a complete 5-state run |
| `DISPLAY=:99 npm run test:browser -- --headed` | 17 tests in a real browser passed |

The frontend core was compared step by step with Python for state, read/write head,
the complete sparse tape, tape window, number of `1` symbols, and recent trace.
The comparisons covered the 2-, 3-, and 4-state machines through halting and the first
1,000 steps of the 5-state machine. The JavaScript core and the Worker in a real browser
each completed the long run. The verified results were:

| Machine | Actual steps to halt | Final number of `1` symbols |
| --- | ---: | ---: |
| 2-state | 6 | 4 |
| 3-state score champion | 14 | 6 |
| 4-state | 107 | 13 |
| 5-state record machine | 47,176,870 | 4,098 |

Browser regressions covered repeated single steps, stepping during playback, stepping
and resuming after a pause, reset, machine switching, slow playback at a fixed speed,
speed changes during playback, raising the limit after reaching it, lowering the limit,
zero steps and invalid input, continued execution beyond 200 steps, prevention of further
steps after halting, and isolation of snapshots from stale commands, runs, or sequences.
Error paths covered HTTP, network, JSON, and machine metadata errors; Worker construction
and module loading failures; startup timeouts; and invalid transitions.

A controllable clock verified the boundaries of steps 1–5, steps 6–100, and the high-speed
phase; 10-millisecond computation batches and 100-millisecond refresh intervals; and
fixed speed remaining in effect beyond 200 steps. The safety-limit test started one step
before the boundary and advanced to 50,000,000 steps, verifying that the limit was shown
with `halted=false`. This boundary test did not constitute a complete run of a non-halting
machine for fifty million steps.

Screenshots from a real browser were also inspected at a desktop width of 1280 pixels
and a mobile width of 390 pixels. The mobile page had no horizontal overflow, and the
tape window was ordered by numeric coordinates with the read/write head kept centered.

## Measured Browser Performance

Full-run timing started when Run (运行 / 继续) was clicked and ended when the final halted
snapshot updated the page. It included about 9.75 seconds of introductory step-by-step
demonstration and used the default settings for the 5-state machine, without skipping
transitions or substituting theoretical records for computation. Pause timing started
when Pause (暂停) was clicked on the page and ended when the interface received the
paused snapshot and completed the DOM update. After each pause, the step count was
confirmed to remain unchanged; a single step was then verified to add exactly one step,
followed by resuming high-speed computation.

| Browser mode | Full-run time | 5 high-speed pause responses (milliseconds) | Maximum pause response |
| --- | ---: | --- | ---: |
| Headless Chromium | 25.76 seconds | 10.3, 12.8, 3.2, 2.8, 12.1 | 12.8 milliseconds |
| Headed Chromium / Xvfb | 25.99 seconds | 6.9, 3.1, 2.9, 2.5, 13.5 | 13.5 milliseconds |

Both sets of measurements met the target pause response of no more than 200 milliseconds
on that date. These are samples from this environment, not guarantees of completion times
or responsiveness on all devices, browsers, or background tabs. Node core execution time
is not used as a measure of browser completion time.

Tests output `BROWSER_FULL_RUN` and `BROWSER_PAUSE` JSON to the console and attach the
measurements through Playwright's `testInfo.attach`. Screenshots and traces are retained
on failure. The `test-results/`, `playwright-report/`, and `node_modules/` directories
are ignored; temporary browser artifacts are not committed.

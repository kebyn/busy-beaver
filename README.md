[English](README.md) | [简体中文](README.zh-CN.md)

# Busy Beaver Flask Demo

A standalone Flask project demonstrating classic two-symbol Busy Beaver Turing machines.
It includes a registry of 2-, 3-, 4-, and 5-state machines, a sparse-tape simulator,
a JSON API, and an animated browser interface.

## Running

```bash
uv sync
uv run python -m unittest discover -v
uv run flask --app busy_beaver web
```

After starting the server, open <http://127.0.0.1:5000/>. The default is the 3-state machine
with a limit of 1,000 steps. **Switching to the 5-state machine selects Run until halt
(运行到停机) by default**; you can manually select Step limit (限定步数) instead.
A complete run of this record machine executes 47,176,870 actual transitions and leaves
4,098 `1` symbols on the tape when it halts.

## Web Controls

- **Step (单步)**: Execute one transition from the current tape. Repeated clicks keep advancing; clicking during playback first pauses execution, then performs one step.
- **Run / Resume (运行 / 继续), Pause (暂停)**: Pausing preserves the tape and progress. Resuming continues from the current position.
- **Reset (重置), machine selection (机器)**: Clear the tape, trace, and progress. Switching machines restores the step limit to 1,000; the 5-state machine defaults to Run until halt, while the others default to Step limit.
- **Execution mode (执行模式), maximum steps (最大步数)**: Changing either first pauses execution and preserves progress. Raising the limit allows execution to continue; lowering it below the number of completed steps stops further execution without undoing any transitions. Step limit accepts integers from 0 to 1,000,000.
- **Automatic acceleration (自动加速)**, the default: The 2- and 3-state machines run at one step per second. The 4- and 5-state machines run their first 5 steps at one step per second, steps 6–100 at 50 milliseconds per step, and then switch to high-speed computation.
- **Fixed speed (固定速度)**: All phases run at 50–2,000 milliseconds per step, with a default of 1,000 milliseconds. Changing the speed during playback immediately restarts the timing interval; changing it while paused does not start execution.

The page fetches the actual transition tables from `/api/machines`, and a browser Web Worker
executes them continuously. During high-speed computation, each batch runs for about
10 milliseconds, with commands such as pause handled between batches. The display updates
about every 100 milliseconds and shows the final result immediately when the machine halts.
Each update uses a single snapshot for the tape, state, read/write head, step count,
number of `1` symbols, and trace. The high-speed display does not show every transition
as a separate frame, but the computation executes every transition.

The recent trace retains a fixed 200 steps; execution continues beyond 200 steps.
Run until halt has a separate safety limit of 50,000,000 steps. The page shows Halted
(已停机) only after the machine actually enters `H`; reaching the limit explicitly shows
Not halted (未停机). The page distinguishes Not started (尚未运行), Running (运行中),
Paused (已暂停), Limit reached (达到上限), Halted (已停机), and Execution error (执行错误).
If loading machine data or initializing the Worker fails, execution buttons are disabled
and an error is shown. An invalid transition terminates the current run; you can reset
or switch machines.

Completion time depends on the device and browser scheduling; background tabs may also
be throttled. The progress bar shows completed steps relative to the selected limit,
not an estimate of the remaining time. See the [verification record](docs/verification.md)
for the measured environment and timings.

## Command Line

You can also run the command-line simulator directly and use `--trace-limit` to control
the number of trace entries retained:

```bash
uv run python -m busy_beaver --machine busy_beaver_5 --max-steps 1000 --trace-limit 200
```

## API

- `GET /api/machines` returns the four machines, their transition tables, and theoretical record metadata.
- `POST /api/simulate` accepts `machine`, `max_steps`, and `trace_limit`, defaulting to the 3-state machine, 1,000 steps, and 200 trace entries. The accepted upper limits are 1,000,000 steps and 10,000 trace entries, respectively; out-of-range values return HTTP 400.

The API and CLI parameters and defaults remain unchanged. The CLI defaults to the 3-state
machine, at most 1,000 steps, and retaining the complete trace. Use `--trace-limit` to
limit memory usage. Browser execution does not call `/api/simulate`; the Worker handles
complete runs without raising the server's safety limits.

There are two classic 3-state Busy Beaver records optimized for different goals:
the score champion leaves 6 `1` symbols after 14 steps, while the runtime champion
leaves 5 `1` symbols after 21 steps. The registry displays both theoretical records,
`S(3)=21` and `Σ(3)=6`, while the simulator keeps its tape results consistent with the
actual transition table.

## Tests

The Python environment continues to use uv. Frontend development tests also require
Node.js 22 or later and npm; running the Flask application does not require Node.js.

```bash
uv sync
uv run python -m unittest discover -v
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

`npm test` covers step-by-step comparisons with Python, control commands, speed rules
using a controllable clock, and a complete 5-state run. Browser tests start their own
Flask server at `127.0.0.1:5057` and verify the actual Worker and page interactions,
including complete 5-state playback, loading failures, isolation of stale messages,
and pause response during high-speed execution. That port must be available.
Performance cases output `BROWSER_FULL_RUN` and `BROWSER_PAUSE` measurements, with a
target foreground pause response of no more than 200 milliseconds. Browser scheduling
and host load affect the results; the same completion time is not guaranteed on every device.

## Documentation

English is the primary language for maintaining documentation. Whenever documentation
is added or changed, provide or update the Chinese version at the same time. Default
document paths contain English; Chinese versions use the `.zh-CN.md` suffix.

| English (primary) | Simplified Chinese |
| --- | --- |
| [README.md](README.md) | [README.zh-CN.md](README.zh-CN.md) |
| [docs/verification.md](docs/verification.md) | [docs/verification.zh-CN.md](docs/verification.zh-CN.md) |

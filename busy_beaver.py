"""Busy beaver machines and the Flask demonstration application.

The simulator deliberately uses a sparse tape.  A blank cell is not stored in
the dictionary, which keeps the common short demonstrations small while still
allowing the head to move in either direction without an artificial boundary.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

import click
from flask import Flask, jsonify, render_template, request
from werkzeug.serving import run_simple


DEFAULT_MACHINE = "busy_beaver_3"
DEFAULT_MAX_STEPS = 1_000
DEFAULT_TRACE_LIMIT = 200
MAX_SERVER_STEPS = 1_000_000
MAX_TRACE_LIMIT = 10_000


@dataclass(frozen=True)
class Transition:
    """One Turing-machine transition.

    ``direction`` is intentionally kept as a string in the public model so a
    malformed custom machine can be passed to the simulator and reported as a
    useful result instead of raising while the machine is being built.
    """

    write: int
    direction: str
    next_state: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "write": self.write,
            "direction": self.direction,
            "next_state": self.next_state,
        }


@dataclass(frozen=True)
class Machine:
    id: str
    name: str
    state_count: int
    start_state: str
    transitions: Mapping[tuple[str, int], Transition]
    theoretical_steps: int
    theoretical_ones: int
    recommended_max_steps: int = DEFAULT_MAX_STEPS
    description: str = ""

    @property
    def states(self) -> int:
        """Compatibility alias used by clients that call this ``states``."""

        return self.state_count

    def to_dict(self) -> dict[str, Any]:
        rules: dict[str, dict[str, dict[str, Any]]] = {}
        for (state, symbol), transition in self.transitions.items():
            rules.setdefault(state, {})[str(symbol)] = transition.as_dict()
        return {
            "id": self.id,
            "name": self.name,
            "state_count": self.state_count,
            "states": self.state_count,
            "start_state": self.start_state,
            "theoretical_steps": self.theoretical_steps,
            "theoretical_ones": self.theoretical_ones,
            "record_steps": self.theoretical_steps,
            "record_ones": self.theoretical_ones,
            "recommended_max_steps": self.recommended_max_steps,
            "description": self.description,
            "transitions": rules,
        }


def _rules(rows: Mapping[str, Mapping[int, tuple[int, str, str]]]) -> dict[tuple[str, int], Transition]:
    return {
        (state, symbol): Transition(write, direction, next_state)
        for state, by_symbol in rows.items()
        for symbol, (write, direction, next_state) in by_symbol.items()
    }


# The transition tables use the conventional A as the initial state, 0 as the
# blank symbol, and H as the halting state.  The 3-state score champion halts
# in 14 transitions with six final ones; S(3)=21 is a different champion (it
# finishes with five ones).  Keeping the actual table and metadata separate is
# important: the UI can show both established records without claiming that a
# single machine achieves incompatible records.
MACHINES: dict[str, Machine] = {
    "busy_beaver_2": Machine(
        id="busy_beaver_2",
        name="2-state busy beaver",
        state_count=2,
        start_state="A",
        transitions=_rules(
            {
                "A": {0: (1, "R", "B"), 1: (1, "L", "B")},
                "B": {0: (1, "L", "A"), 1: (1, "R", "H")},
            }
        ),
        theoretical_steps=6,
        theoretical_ones=4,
        description="Classic 2-state, 2-symbol machine.",
    ),
    "busy_beaver_3": Machine(
        id="busy_beaver_3",
        name="3-state busy beaver",
        state_count=3,
        start_state="A",
        transitions=_rules(
            {
                "A": {0: (1, "R", "B"), 1: (1, "R", "H")},
                "B": {0: (0, "R", "C"), 1: (1, "R", "B")},
                "C": {0: (1, "L", "C"), 1: (1, "L", "A")},
            }
        ),
        theoretical_steps=21,
        theoretical_ones=6,
        description="Classic 3-state score champion (14 steps, six final ones).",
    ),
    "busy_beaver_4": Machine(
        id="busy_beaver_4",
        name="4-state busy beaver",
        state_count=4,
        start_state="A",
        transitions=_rules(
            {
                "A": {0: (1, "R", "B"), 1: (1, "L", "B")},
                "B": {0: (1, "L", "A"), 1: (0, "L", "C")},
                "C": {0: (1, "R", "H"), 1: (1, "L", "D")},
                "D": {0: (1, "R", "D"), 1: (0, "R", "A")},
            }
        ),
        theoretical_steps=107,
        theoretical_ones=13,
        description="Classic 4-state, 2-symbol machine.",
    ),
    "busy_beaver_5": Machine(
        id="busy_beaver_5",
        name="5-state busy beaver",
        state_count=5,
        start_state="A",
        transitions=_rules(
            {
                "A": {0: (1, "R", "B"), 1: (1, "L", "C")},
                "B": {0: (1, "R", "C"), 1: (1, "R", "B")},
                "C": {0: (1, "R", "D"), 1: (0, "L", "E")},
                "D": {0: (1, "L", "A"), 1: (1, "L", "D")},
                "E": {0: (1, "R", "H"), 1: (0, "L", "A")},
            }
        ),
        theoretical_steps=47_176_870,
        theoretical_ones=4_098,
        description=(
            "Marxen–Buntrock record machine; the full run is intentionally "
            "not the web default."
        ),
    ),
}

# Public alias for callers that prefer the registry terminology.
MACHINE_REGISTRY = MACHINES


@dataclass
class SimulationResult:
    machine: Machine
    steps_executed: int
    halted: bool
    halt_reason: str
    state: str
    head_position: int
    ones: int
    tape: dict[int, int]
    trace: list[dict[str, Any]]

    def tape_window(self, radius: int = 12) -> dict[str, int]:
        return {
            str(position): self.tape.get(position, 0)
            for position in range(self.head_position - radius, self.head_position + radius + 1)
        }

    def to_dict(self) -> dict[str, Any]:
        cells = {str(position): value for position, value in sorted(self.tape.items()) if value}
        return {
            "machine": self.machine.id,
            "steps_executed": self.steps_executed,
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "state": self.state,
            "current_state": self.state,
            "head_position": self.head_position,
            "ones": self.ones,
            "tape": cells,
            "tape_window": self.tape_window(),
            "trace": self.trace,
        }


class BusyBeaverSimulator:
    """Run one machine from a blank tape."""

    def __init__(self, machine: Machine):
        self.machine = machine

    def run(
        self,
        max_steps: int = DEFAULT_MAX_STEPS,
        trace_limit: int | None = DEFAULT_TRACE_LIMIT,
    ) -> SimulationResult:
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 0:
            raise ValueError("max_steps must be a non-negative integer")
        if trace_limit is not None and (
            isinstance(trace_limit, bool) or not isinstance(trace_limit, int) or trace_limit < 0
        ):
            raise ValueError("trace_limit must be a non-negative integer")

        tape: dict[int, int] = {}
        position = 0
        state = self.machine.start_state
        steps = 0
        ones = 0
        trace: deque[dict[str, Any]] = deque(maxlen=trace_limit)
        halted = False
        reason = "maximum step limit reached"

        while steps < max_steps and state != "H":
            symbol = tape.get(position, 0)
            transition = self.machine.transitions.get((state, symbol))
            if transition is None:
                reason = "missing transition"
                break
            try:
                if isinstance(transition, Transition):
                    write, direction, next_state = (
                        transition.write,
                        transition.direction,
                        transition.next_state,
                    )
                elif isinstance(transition, Mapping):
                    write = transition["write"]
                    direction = transition.get("direction", transition.get("move"))
                    next_state = transition.get("next_state", transition.get("state"))
                else:
                    write, direction, next_state = transition
            except (KeyError, TypeError, ValueError):
                reason = "invalid transition"
                break
            if write not in (0, 1):
                reason = "invalid write symbol"
                break
            if direction not in ("L", "R"):
                reason = "invalid direction"
                break

            before = {
                "step": steps + 1,
                "state": state,
                "position": position,
                "read": symbol,
            }
            old = tape.get(position, 0)
            if write:
                tape[position] = 1
            else:
                tape.pop(position, None)
            ones += write - old
            position += 1 if direction == "R" else -1
            state = next_state
            steps += 1
            before.update(
                {
                    "write": write,
                    "direction": direction,
                    "next_state": state,
                    "next_position": position,
                }
            )
            if trace_limit != 0:
                trace.append(before)

            if state == "H":
                halted = True
                reason = "HALT transition"
                break

        return SimulationResult(
            machine=self.machine,
            steps_executed=steps,
            halted=halted,
            halt_reason=reason,
            state="HALT" if state == "H" else state,
            head_position=position,
            ones=ones,
            tape=dict(tape),
            trace=list(trace),
        )


def simulate(
    machine_id: str = DEFAULT_MACHINE,
    max_steps: int = DEFAULT_MAX_STEPS,
    trace_limit: int | None = DEFAULT_TRACE_LIMIT,
) -> SimulationResult:
    try:
        machine = MACHINES[machine_id]
    except KeyError as exc:
        raise ValueError(f"unknown machine: {machine_id}") from exc
    return BusyBeaverSimulator(machine).run(max_steps=max_steps, trace_limit=trace_limit)


def get_machine(machine_id: str) -> Machine:
    """Return a registered machine or raise ``ValueError`` for unknown ids."""

    try:
        return MACHINES[machine_id]
    except KeyError as exc:
        raise ValueError(f"unknown machine: {machine_id}") from exc


def _parse_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    return value


app = Flask(__name__, template_folder="templates", static_folder="static")


@app.get("/")
def index():
    return render_template(
        "index.html",
        machines=list(MACHINES.values()),
        default_machine=DEFAULT_MACHINE,
        default_max_steps=DEFAULT_MAX_STEPS,
        max_server_steps=MAX_SERVER_STEPS,
    )


@app.get("/api/machines")
def list_machines():
    return jsonify(
        {
            "machines": [machine.to_dict() for machine in MACHINES.values()],
            "default_machine": DEFAULT_MACHINE,
            "default_max_steps": DEFAULT_MAX_STEPS,
            "max_server_steps": MAX_SERVER_STEPS,
        }
    )


@app.post("/api/simulate")
def api_simulate():
    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return jsonify({"error": "request body must be a JSON object"}), 400

    machine_id = payload.get("machine", DEFAULT_MACHINE)
    max_steps = payload.get("max_steps", DEFAULT_MAX_STEPS)
    trace_limit = payload.get("trace_limit", DEFAULT_TRACE_LIMIT)
    try:
        if not isinstance(machine_id, str) or machine_id not in MACHINES:
            raise ValueError(f"unknown machine: {machine_id}")
        max_steps = _parse_int(max_steps, "max_steps")
        trace_limit = _parse_int(trace_limit, "trace_limit")
        if max_steps < 0 or max_steps > MAX_SERVER_STEPS:
            raise ValueError(f"max_steps must be between 0 and {MAX_SERVER_STEPS}")
        if trace_limit < 0 or trace_limit > MAX_TRACE_LIMIT:
            raise ValueError(f"trace_limit must be between 0 and {MAX_TRACE_LIMIT}")
        result = simulate(machine_id, max_steps=max_steps, trace_limit=trace_limit)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result.to_dict())


@app.cli.command("web")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=5000, type=int, show_default=True)
def web_command(host: str, port: int):
    """Run the demonstration web server (``flask --app busy_beaver web``)."""

    # Flask's CLI deliberately ignores ``app.run`` to avoid accidentally
    # starting a second server.  ``run_simple`` is the direct development
    # server entry point and therefore works both through ``flask web`` and
    # when this command is invoked from a test process.
    run_simple(host, port, app)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine", choices=tuple(MACHINES), default=DEFAULT_MACHINE)
    parser.add_argument("--max-steps", type=int, default=DEFAULT_MAX_STEPS)
    parser.add_argument("--trace-limit", type=int, default=None)
    args = parser.parse_args(argv)
    result = simulate(args.machine, args.max_steps, args.trace_limit)
    import json

    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

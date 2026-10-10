"""Generate independent Python snapshots for JavaScript parity tests."""
import json

from busy_beaver import MACHINES, simulate

print(json.dumps({
    "machines": {key: machine.to_dict() for key, machine in MACHINES.items()},
    "snapshots": {
        key: [simulate(key, steps, 200).to_dict()
              for steps in [*range(min(machine.theoretical_steps, 260) + 1), 1000]]
        for key, machine in MACHINES.items()
    },
}))

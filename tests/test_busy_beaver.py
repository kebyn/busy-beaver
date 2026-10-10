import unittest

import busy_beaver


class BusyBeaverSimulatorTests(unittest.TestCase):
    def test_record_machines(self):
        expected = {
            "busy_beaver_2": (6, 4),
            "busy_beaver_3": (14, 6),
            "busy_beaver_4": (107, 13),
        }
        for machine_id, (steps, ones) in expected.items():
            with self.subTest(machine=machine_id):
                result = busy_beaver.simulate(machine_id, max_steps=1_000, trace_limit=0)
                self.assertTrue(result.halted)
                self.assertEqual((result.steps_executed, result.ones), (steps, ones))
                self.assertEqual(result.halt_reason, "HALT transition")
                self.assertEqual(result.trace, [])

    def test_five_state_default_limit_and_trace_window(self):
        self.assertEqual(busy_beaver.MACHINES["busy_beaver_5"].theoretical_steps, 47_176_870)
        self.assertEqual(busy_beaver.MACHINES["busy_beaver_5"].theoretical_ones, 4_098)
        result = busy_beaver.simulate("busy_beaver_5", max_steps=1_000, trace_limit=7)
        self.assertFalse(result.halted)
        self.assertEqual(result.steps_executed, 1_000)
        self.assertEqual(result.halt_reason, "maximum step limit reached")
        self.assertEqual(len(result.trace), 7)
        self.assertEqual(result.trace[0]["step"], 994)

    def test_missing_transition_and_invalid_direction_are_reported(self):
        machine = busy_beaver.Machine(
            id="missing",
            name="missing",
            state_count=1,
            start_state="A",
            transitions={},
            theoretical_steps=0,
            theoretical_ones=0,
        )
        result = busy_beaver.BusyBeaverSimulator(machine).run(10)
        self.assertFalse(result.halted)
        self.assertEqual(result.halt_reason, "missing transition")

        machine = busy_beaver.Machine(
            id="invalid",
            name="invalid",
            state_count=1,
            start_state="A",
            transitions={("A", 0): busy_beaver.Transition(1, "sideways", "A")},
            theoretical_steps=0,
            theoretical_ones=0,
        )
        result = busy_beaver.BusyBeaverSimulator(machine).run(10)
        self.assertFalse(result.halted)
        self.assertEqual(result.halt_reason, "invalid direction")

        tuple_machine = busy_beaver.Machine(
            id="tuple",
            name="tuple",
            state_count=1,
            start_state="A",
            transitions={("A", 0): (1, "R", "H")},
            theoretical_steps=1,
            theoretical_ones=1,
        )
        result = busy_beaver.BusyBeaverSimulator(tuple_machine).run(10)
        self.assertTrue(result.halted)
        self.assertEqual(result.ones, 1)


class BusyBeaverApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        busy_beaver.app.config.update(TESTING=True)
        cls.client = busy_beaver.app.test_client()

    def test_machine_registry_and_page_defaults(self):
        response = self.client.get("/api/machines")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(
            [machine["id"] for machine in payload["machines"]],
            ["busy_beaver_2", "busy_beaver_3", "busy_beaver_4", "busy_beaver_5"],
        )
        self.assertEqual(payload["default_machine"], "busy_beaver_3")
        self.assertEqual(payload["default_max_steps"], 1_000)

        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        self.assertIn('value="busy_beaver_3" selected', html)
        self.assertIn('id="max-steps"', html)
        self.assertIn('value="1000"', html)

    def test_simulation_defaults_and_limit(self):
        response = self.client.post("/api/simulate", json={})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["machine"], "busy_beaver_3")
        self.assertEqual(payload["steps_executed"], 14)
        self.assertTrue(payload["halted"])
        self.assertEqual(payload["ones"], 6)

        response = self.client.post(
            "/api/simulate",
            json={"machine": "busy_beaver_5", "max_steps": 1_000, "trace_limit": 2},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["steps_executed"], 1_000)
        self.assertFalse(payload["halted"])
        self.assertEqual(payload["halt_reason"], "maximum step limit reached")
        self.assertEqual(len(payload["trace"]), 2)

    def test_invalid_requests_return_bad_request(self):
        for body in (
            {"machine": "nope"},
            {"max_steps": -1},
            {"max_steps": busy_beaver.MAX_SERVER_STEPS + 1},
            {"trace_limit": -1},
            {"trace_limit": busy_beaver.MAX_TRACE_LIMIT + 1},
        ):
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/api/simulate", json=body).status_code, 400)


if __name__ == "__main__":
    unittest.main()

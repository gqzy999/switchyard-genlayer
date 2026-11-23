import unittest
from host import contract


class SwitchyardTest(unittest.TestCase):
    def setUp(self):
        self.game, self.msg, self.responses, self.scope = contract(
            "contracts/switchyard.py", "Switchyard", "west"
        )
        self.key = "west/split"
        self.game.open_match("split", "east")

    def sign(self):
        self.game.dispatch(self.key, "Tick 1 North, tick 2 East, tick 3 wait.")
        self.msg.sender_address = "east"
        self.game.dispatch(self.key, "Tick 1 South, tick 2 West, tick 3 wait.")

    def test_permission_and_immutable_dispatch(self):
        with self.assertRaisesRegex(ValueError, "MATCH_EXISTS"):
            self.game.open_match("split", "other")
        with self.assertRaisesRegex(ValueError, "NOT_READY"):
            self.game.resolve(self.key)
        self.msg.sender_address = "third"
        with self.assertRaisesRegex(ValueError, "PLAYER_REQUIRED"):
            self.game.dispatch(self.key, "A long dispatch.")
        self.msg.sender_address = "west"
        self.game.dispatch(self.key, "A long dispatch.")
        prior = self.game.get_match(self.key)
        with self.assertRaisesRegex(ValueError, "DISPATCH_ALREADY_SIGNED"):
            self.game.dispatch(self.key, "A different dispatch.")
        self.assertEqual(prior, self.game.get_match(self.key))

    def test_consensus_success_and_terminal_state(self):
        self.sign()
        plans = {"plans": [["N", "E", "WAIT"], ["S", "W", "WAIT"]]}
        self.responses.extend([plans, plans])
        self.game.resolve(self.key)
        self.assertIn('"state":"CLEARED"', self.game.get_match(self.key))
        with self.assertRaisesRegex(ValueError, "NOT_READY"):
            self.game.resolve(self.key)

    def test_validator_disagreement_preserves_ready(self):
        self.sign()
        self.responses.extend([
            {"plans": [["N", "E", "WAIT"], ["S", "W", "WAIT"]]},
            {"plans": [["N", "E", "WAIT"], ["N", "W", "WAIT"]]},
        ])
        before = self.game.get_match(self.key)
        with self.assertRaisesRegex(ValueError, "VALIDATORS_DISAGREE"):
            self.game.resolve(self.key)
        self.assertEqual(before, self.game.get_match(self.key))

    def test_replay_failures(self):
        for west, east, expected in [
            (["N", "E", "WAIT"], ["N", "W", "WAIT"], "OCCUPANCY_CONFLICT"),
            (["N", "W", "WAIT"], ["WAIT", "N", "WAIT"], "TIME_LIMIT"),
            (["E", "WAIT", "WAIT"], ["S", "WAIT", "WAIT"], "ILLEGAL_TRACK"),
            (["N", "E", "WAIT"], ["WAIT", "N", "WAIT"], "HEAD_ON_SWAP"),
            (["?", "E", "WAIT"], ["S", "W", "WAIT"], "UNRESOLVED_INSTRUCTION"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(self.scope["replay"]([west, east])["reason"], expected)

"""Unit tests for the statistics in analyze.py. Run: python3 -m unittest discover -s eval/selection/tests -p 'test_*.py'"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import analyze as A


class T(unittest.TestCase):
    def test_sign_test_exact(self):
        self.assertAlmostEqual(A.sign_test([1] * 9 + [-1])[2], 22 / 1024)
        self.assertEqual(A.sign_test([0, 0, 0])[2], 1.0)
        self.assertAlmostEqual(A.sign_test([1] * 5)[2], 2 / 32)

    def test_holm(self):
        adj = A.holm([0.01, 0.04, 0.03])
        self.assertAlmostEqual(adj[0], 0.03)
        self.assertAlmostEqual(adj[2], 0.06)
        self.assertAlmostEqual(adj[1], 0.06)

    def test_bootstrap_constant(self):
        self.assertEqual(A.boot_ci({"a": 0.5, "b": 0.5}, b=200), (0.5, 0.5, 0.5))

    def test_per_persona_denominator(self):
        rows = [{"persona": "p1", "conds": {"x": {"final": 1}}, "cue": True},
                {"persona": "p1", "conds": {"x": {"final": 0}}, "cue": False},
                {"persona": "p2", "conds": {"x": {"final": 1}}, "cue": True}]
        self.assertEqual(A.per_persona(rows, "x"), {"p1": 0.5, "p2": 1.0})
        self.assertEqual(A.per_persona(rows, "x", pred=lambda r: not r["cue"]), {"p1": 0.0})

    def test_paired(self):
        d = A.paired({"a": 1.0, "b": 0.5, "c": 0.5}, {"a": 0.5, "b": 0.5, "c": 0.0})
        self.assertAlmostEqual(d["diff"], 1 / 3)
        self.assertEqual((d["pos"], d["neg"], d["ties"]), (2, 0, 1))


if __name__ == "__main__":
    unittest.main()

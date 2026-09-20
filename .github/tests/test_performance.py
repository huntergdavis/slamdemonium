import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location(
    "performance", Path(__file__).parents[1] / "scripts/performance.py")
perf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(perf)


def report():
    timing = {"count": 1000, "meanMs": 1.0, "p50Ms": 0.8, "p95Ms": 1.5,
              "p99Ms": 2.0, "minMs": 0.1, "maxMs": 3.0,
              "standardDeviationMs": 0.2}
    memory = {"elapsedSeconds": 60, "jsUsedBytes": 1000,
              "wasmHeapBytes": 2000, "wasmUsedBytes": 100}
    return {
        "schemaVersion": 1, "recordedAt": "2026-09-20T22:00:00.000Z",
        "revision": "a" * 40, "passed": True, "failures": [],
        "mode": "sustained",
        "scenario": {"name": "physics-demo"},
        "parameters": {"mass": 1200, "gravity": 9.81},
        "parameterFingerprint": "b" * 64,
        "configurationFingerprint": "c" * 64,
        "timing": {key: copy.deepcopy(timing) for key in perf.TIMINGS},
        "memory": {"first": memory,
                   "minuteFive": {**memory, "elapsedSeconds": 300},
                   "last": {**memory, "elapsedSeconds": 308},
                   "jsUsedPercent": 0, "wasmUsedPercent": 0,
                   "wasmCapacityPercent": 0},
    }


def archive(value, name="perf.json"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as bundle:
        bundle.writestr(name, json.dumps(value))
    return output.getvalue()


class PerformanceTests(unittest.TestCase):
    def test_design_boundaries_pass_and_exceedances_fail(self):
        value = report()
        self.assertTrue(perf.gates_pass(perf.validate(value)))
        for _, heap, growth in perf.HEAPS:
            with self.subTest(heap=heap):
                value = report()
                first = value["memory"]["first"][heap]
                value["memory"]["last"][heap] = first * 1.1
                value["memory"][growth] = 10
                self.assertTrue(perf.gates_pass(perf.validate(value)))
                value["memory"]["last"][heap] = first * 1.10001
                value["memory"][growth] = 10.001
                with self.assertRaises(ValueError):
                    perf.validate(value)
                value["passed"] = False
                self.assertFalse(perf.gates_pass(perf.validate(value)))
        value = report()
        value["timing"]["physicsStep"]["p99Ms"] = 2.0001
        with self.assertRaises(ValueError):
            perf.validate(value)
        value["passed"] = False
        self.assertFalse(perf.gates_pass(perf.validate(value)))

    def test_missing_or_nonfinite_measurements_never_become_zero(self):
        for bad in (None, float("nan"), float("inf"), -1, True):
            value = report()
            value["timing"]["frame"]["p99Ms"] = bad
            with self.subTest(value=bad), self.assertRaises(ValueError):
                perf.validate(value)
        value = report()
        del value["parameters"]
        with self.assertRaises(KeyError):
            perf.validate(value)
        value = report()
        value["memory"]["jsUsedPercent"] = 5
        with self.assertRaises(ValueError):
            perf.validate(value)

    def test_summary_exposes_distribution_parameters_and_failed_history(self):
        previous = report()
        previous["passed"] = False
        previous["failures"] = ["Browser error"]
        previous["configurationFingerprint"] = "d" * 64
        output = perf.render(report(), [(previous, "https://example.test/run")],
                             [], "https://example.test/current")
        for text in ("P50", "P95", "P99", "Std. dev.", "variance is expected",
                     "mass", "1200", "WASM used", "FAIL", "d" * 12, "b" * 64,
                     "not directly comparable"):
            self.assertIn(text, output)
        self.assertIn("Minute five (MiB)", output)
        self.assertIn("Final EOF (MiB)", output)

    def test_sustained_report_requires_actual_minute_five_measurement(self):
        for value in (None, {**report()["memory"]["first"], "elapsedSeconds": 299}):
            sample = report()
            sample["memory"]["minuteFive"] = value
            with self.subTest(checkpoint=value), self.assertRaises(ValueError):
                perf.validate(sample)
        sample = report()
        sample["mode"] = "smoke/custom"
        sample["memory"]["minuteFive"] = None
        self.assertEqual(perf.verdict(perf.validate(sample)), "SMOKE/CUSTOM")

    def test_archive_reads_only_the_bounded_report_member(self):
        self.assertEqual(perf.read_archive(archive(report())), report())
        for name in ("../perf.json", "/perf.json", "other.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                perf.read_archive(archive(report(), name))

    def test_history_includes_failed_main_runs_and_ignores_other_branches(self):
        old = report()
        old["recordedAt"] = "2026-09-19T22:00:00.000Z"
        old["passed"] = False
        old["failures"] = ["Browser error"]
        run = {"id": 7, "conclusion": "failure", "head_branch": "main",
               "head_sha": "a" * 40, "html_url": "https://example.test/run/7"}

        def api(path, binary=False):
            if "workflows/performance.yml/runs?" in path:
                return {"workflow_runs": [
                    {**run, "id": 9},  # Current run: exclude.
                    {**run, "id": 8, "head_branch": "devops/experiment"},
                    run]}
            if path.endswith("/runs/7/artifacts"):
                return {"artifacts": [{"id": 70, "name": perf.ARTIFACT,
                                       "expired": False, "size_in_bytes": 4000}]}
            if path.endswith("/artifacts/70/zip"):
                self.assertTrue(binary)
                return archive(old)
            self.fail(f"Unexpected API call: {path}")

        with patch.dict(os.environ, {"GH_TOKEN": "test"}), patch.object(
                perf, "api", side_effect=api):
            records, notes = perf.history(report(), "owner/repo", "9")
        self.assertEqual(records, [(old, run["html_url"])])
        self.assertEqual(notes, [])

    def test_history_rejects_a_report_from_the_wrong_revision(self):
        old = report()
        old["recordedAt"] = "2026-09-19T22:00:00.000Z"
        answers = [
            {"workflow_runs": [
                {"id": 7, "conclusion": "success", "head_branch": "main",
                 "head_sha": "e" * 40, "html_url": "https://example.test/run/7"}]},
            {"artifacts": [{"id": 70, "name": perf.ARTIFACT,
                            "expired": False, "size_in_bytes": 4000}]},
            archive(old),
        ]
        with patch.dict(os.environ, {"GH_TOKEN": "test"}), patch.object(
                perf, "api", side_effect=answers):
            records, notes = perf.history(report(), "owner/repo", "9")
        self.assertEqual(records, [])
        self.assertIn("unavailable or incompatible", notes[0])

    def test_missing_report_and_harness_failures_fail_with_visible_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            root = Path(directory)
            source = root / "perf.json"
            summary = root / "perf-summary.md"
            with patch.object(perf, "REPORT", source), patch.object(
                    perf, "SUMMARY", summary), patch.dict(
                    os.environ, {"GITHUB_STEP_SUMMARY": str(root / "job.md")},
                    clear=True):
                self.assertEqual(perf.main(), 1)
                self.assertIn("Missing measurements are not treated as zero",
                              summary.read_text())
                failed = report()
                failed["passed"] = False
                failed["failures"] = ["Recorder overflow"]
                source.write_text(json.dumps(failed))
                self.assertEqual(perf.main(), 1)
                self.assertIn("Recorder overflow", summary.read_text())
                smoke = report()
                smoke["mode"] = "smoke/custom"
                source.write_text(json.dumps(smoke))
                self.assertEqual(perf.main(), 1)
                self.assertIn("**SMOKE/CUSTOM**", summary.read_text())
                source.write_text(json.dumps(report()))
                self.assertEqual(perf.main(), 0)
                self.assertIn("**PASS**", summary.read_text())
                self.assertIn("P95", (root / "job.md").read_text())

    def test_history_outage_does_not_change_measurement_or_gate_result(self):
        with patch.dict(os.environ, {"GH_TOKEN": "test"}), patch.object(
                perf, "api", side_effect=OSError("offline")):
            records, notes = perf.history(report(), "owner/repo", "9")
        self.assertEqual(records, [])
        self.assertIn("could not be read", notes[0])
        self.assertTrue(perf.gates_pass(report()))


if __name__ == "__main__":
    unittest.main()

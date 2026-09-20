import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location(
    "performance", Path(__file__).parents[1] / "scripts/performance.py")
perf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(perf)
BASE_CPUS = perf.BASELINE["runner"]["logicalCpus"]
OTHER_CPUS = BASE_CPUS * 2


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
        "runner": {**{k: v for k, v in perf.BASELINE["runner"].items() if k != "label"},
                   "imageVersion": "fixture-image"},
        "baseline": copy.deepcopy(perf.BASELINE),
        "host": {"logicalCpus": BASE_CPUS, "platform": "linux", "arch": "x64", "cpu": "test CPU"},
        "timing": {key: copy.deepcopy(timing) for key in perf.TIMINGS},
        "manualBaseline": {"completedSteps": timing["count"],
                           "physicsStep": copy.deepcopy(timing),
                           "engineStep": copy.deepcopy(timing)},
        "physicsGate": {"source": "manualBaseline.physicsStep",
                        "p99Ms": 2.0, "limitMs": 2},
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
    def test_runner_changes_record_identity_without_claiming_same_class(self):
        expected = perf.BASELINE["runner"]
        env = {"PERF_RUNNER_ENVIRONMENT": expected["environment"], "RUNNER_OS": expected["os"],
               "RUNNER_ARCH": expected["architecture"], "ImageOS": expected["imageOS"],
               "ImageVersion": "fixture"}
        with patch.dict(os.environ, env, clear=True), patch.object(
                perf.platform, "freedesktop_os_release", return_value={
                    "ID": expected["distribution"], "VERSION_ID": expected["osVersion"]}), patch.object(
                    perf.os, "cpu_count", return_value=BASE_CPUS):
            runner = perf.observed_runner()
        self.assertTrue(perf.runner_matches({"runner": runner}))
        for key, value in (("logicalCpus", OTHER_CPUS), ("environment", "different"),
                           ("architecture", "different"), ("osVersion", "different"),
                           ("imageOS", "different"), ("os", "different")):
            with self.subTest(key=key):
                self.assertFalse(perf.runner_matches({"runner": {**runner, key: value}}))

    def test_changed_class_skips_only_numerical_gates(self):
        value = report()
        value["runner"]["logicalCpus"] = value["host"]["logicalCpus"] = OTHER_CPUS
        self.assertEqual(perf.verdict(perf.validate(value)), "GATE SKIPPED")
        value["manualBaseline"]["physicsStep"]["p99Ms"] = 8.5
        value["physicsGate"]["p99Ms"] = 8.5
        value["memory"]["last"]["jsUsedBytes"] = 1120
        value["memory"]["jsUsedPercent"] = 12
        value["passed"] = False
        value["harnessExitCode"] = 1
        value["failures"] = ["Physics p99 8.500 ms exceeds 2 ms.",
                             "jsUsedPercent grew 12.00%, exceeding 10%."]
        self.assertEqual(perf.verdict(perf.validate(value)), "GATE SKIPPED")
        output = perf.render(value, [], [], "#")
        self.assertIn("**GATE SKIPPED**", output)
        self.assertIn(f"| logicalCpus | {BASE_CPUS} | {OTHER_CPUS} |", output)
        self.assertIn("8.500 | ≤ 2 ms | SKIPPED", output)
        self.assertIn("Never compare local CPU timings", output)
        headroom = perf.BASELINE["limits"]["physicsP99Ms"] / perf.BASELINE["measurement"]["physicsP99Ms"]
        self.assertIn(f"{headroom:.1f}×", output)
        matching = copy.deepcopy(value)
        matching["runner"]["logicalCpus"] = matching["host"]["logicalCpus"] = BASE_CPUS
        self.assertEqual(perf.verdict(perf.validate(matching)), "FAIL")
        for failure in ("Recorder overflow: 1 samples lost; percentiles are incomplete.",
                        "Captured samples do not cover every completed replay step.",
                        "Browser error", "Physics p99 9.000 ms exceeds 2 ms."):
            broken = copy.deepcopy(value)
            broken["failures"].append(failure)
            with self.subTest(failure=failure):
                self.assertEqual(perf.verdict(perf.validate(broken)), "FAIL")
        value["harnessExitCode"] = 137
        self.assertEqual(perf.verdict(perf.validate(value)), "FAIL")

    def test_changed_class_report_retains_measurements_and_malformed_still_fails(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            root = Path(directory)
            source, summary, status = root / "perf.json", root / "summary.md", root / "exit.txt"
            value = report()
            value["runner"]["logicalCpus"] = value["host"]["logicalCpus"] = OTHER_CPUS
            value["manualBaseline"]["physicsStep"]["p99Ms"] = 8.5
            value["physicsGate"]["p99Ms"] = 8.5
            value["passed"] = False
            value["failures"] = ["Physics p99 8.500 ms exceeds 2 ms."]
            source.write_text(json.dumps(value))
            status.write_text("1\n")
            with patch.object(perf, "REPORT", source), patch.object(
                    perf, "SUMMARY", summary), patch.object(perf, "EXIT_CODE", status), patch.object(
                    perf, "observed_runner", return_value=value["runner"]), patch.dict(
                    os.environ, {"GITHUB_ACTIONS": "true"}, clear=True):
                self.assertEqual(perf.main(), 0)
                saved = json.loads(source.read_text())
                self.assertEqual(saved["timing"], value["timing"])
                self.assertEqual(saved["manualBaseline"], value["manualBaseline"])
                self.assertEqual(saved["baseline"], perf.BASELINE)
                self.assertEqual(saved["harnessExitCode"], 1)
                self.assertFalse(saved["passed"])
                self.assertIn("**GATE SKIPPED**", summary.read_text())
                del value["manualBaseline"]
                source.write_text(json.dumps(value))
                self.assertEqual(perf.main(), 1)
                self.assertIn("no complete, valid report", summary.read_text())

    def test_workflow_preserves_real_process_exit_for_the_reporter(self):
        workflow = (Path(__file__).parents[1] / "workflows/performance.yml").read_text()
        section = workflow.split("      - name: Measure performance", 1)[1]
        command = textwrap.dedent(section.split("        run: |\n", 1)[1].split(
            "\n      - name:", 1)[0])
        for code in (0, 1, 137):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stub = root / "npm"
                stub.write_text('#!/bin/bash\nprintf "measurement output\\n"\nexit "$PERF_STUB_EXIT"\n')
                stub.chmod(0o755)
                env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                       "PERF_STUB_EXIT": str(code), "PERF_PHYSICS_LIMIT": "2", "PERF_HEAP_LIMIT": "10"}
                result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", command],
                                        cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / "test-results/perf-exit-code.txt").read_text(), f"{code}\n")
                self.assertIn("measurement output", (root / "test-results/perf-console.log").read_text())

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
        value["manualBaseline"]["physicsStep"]["p99Ms"] = 2.0001
        value["physicsGate"]["p99Ms"] = 2.0001
        with self.assertRaises(ValueError):
            perf.validate(value)
        value["passed"] = False
        self.assertFalse(perf.gates_pass(perf.validate(value)))

    def test_raf_distributions_never_gate_the_manual_measurement(self):
        value = report()
        for name in perf.TIMINGS:
            value["timing"][name]["p99Ms"] = 999
            value["timing"][name]["maxMs"] = 1000
        value["manualBaseline"]["physicsStep"]["p99Ms"] = 0.5
        value["physicsGate"]["p99Ms"] = 0.5
        self.assertEqual(perf.verdict(perf.validate(value)), "PASS")
        output = perf.render(value, [], [], "#")
        self.assertIn("Manual full physics step | 1000 | 0.500 | ≤ 2 ms | PASS", output)
        self.assertIn("Manual physics P99 ms", output)
        self.assertIn("| 0.500 | 0.80 / 1.50 / 999.00 |", output)
        self.assertIn("All requestAnimationFrame (RAF) distributions below are advisory", output)
        self.assertIn("manualBaseline.physicsStep.p99Ms", output)

    def test_gate_provenance_must_match_complete_manual_measurement(self):
        for key, bad in (("source", "timing.physicsStep"), ("p99Ms", 0.5),
                         ("p99Ms", float("nan")), ("limitMs", 3)):
            value = report()
            value["physicsGate"][key] = bad
            with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                perf.validate(value)
        value = report()
        value["manualBaseline"]["completedSteps"] += 1
        with self.assertRaises(ValueError):
            perf.validate(value)
        value = report()
        del value["physicsGate"]
        with self.assertRaises(KeyError):
            perf.validate(value)

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

    def test_history_keeps_changed_class_measurements_separate(self):
        old = report()
        old["recordedAt"] = "2026-09-19T22:00:00.000Z"
        old["runner"]["logicalCpus"] = old["host"]["logicalCpus"] = OTHER_CPUS
        for cpus in (BASE_CPUS, OTHER_CPUS):
            current = report()
            current["runner"]["logicalCpus"] = current["host"]["logicalCpus"] = cpus
            answers = [
                {"workflow_runs": [{"id": 7, "conclusion": "success", "head_branch": "main",
                                     "head_sha": "a" * 40, "html_url": "https://example.test/run/7"}]},
                {"artifacts": [{"id": 70, "name": perf.ARTIFACT,
                                "expired": False, "size_in_bytes": 4000}]},
                archive(old),
            ]
            with self.subTest(cpus=cpus), patch.dict(os.environ, {"GH_TOKEN": "test"}), patch.object(
                    perf, "api", side_effect=answers):
                records, notes = perf.history(current, "owner/repo", "9")
                self.assertEqual(len(records), 1 if cpus == OTHER_CPUS else 0)
                if cpus == OTHER_CPUS:
                    self.assertEqual(perf.verdict(records[0][0]), "GATE SKIPPED")
                    self.assertEqual(notes, [])
                else:
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

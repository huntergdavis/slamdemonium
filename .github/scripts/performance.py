"""Summarize WP9a reports and recent main measurements without repository writes."""

import html
import io
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import zipfile


REPORT = Path("test-results/perf.json")
SUMMARY = Path("test-results/perf-summary.md")
ARTIFACT = "performance-results"
BASELINE = json.loads((Path(__file__).parents[1] / "performance-baseline.json").read_text())
RUNNER_FIELDS = ("environment", "os", "architecture", "distribution", "osVersion",
                 "imageOS", "logicalCpus")
EXIT_CODE = Path("test-results/perf-exit-code.txt")
TIMINGS = ("frame", "physicsStep", "engineStep")
STATS = ("meanMs", "p50Ms", "p95Ms", "p99Ms", "minMs", "maxMs",
         "standardDeviationMs")
HEAPS = (("JS retained", "jsUsedBytes", "jsUsedPercent"),
         ("WASM used", "wasmUsedBytes", "wasmUsedPercent"),
         ("WASM capacity", "wasmHeapBytes", "wasmCapacityPercent"))
FENCE = chr(96) * 3


def observed_runner():
    """Record changes without discarding measurements from a new runner class."""
    try:
        release = platform.freedesktop_os_release()
    except OSError:
        release = {}
    return {
        "environment": os.environ.get("PERF_RUNNER_ENVIRONMENT"),
        "os": os.environ.get("RUNNER_OS"),
        "architecture": os.environ.get("RUNNER_ARCH"),
        "distribution": release.get("ID"), "osVersion": release.get("VERSION_ID"),
        "imageOS": os.environ.get("ImageOS"),
        "imageVersion": os.environ.get("ImageVersion"),
        "logicalCpus": os.cpu_count(),
    }


def runner_identity(runner):
    return {key: runner.get(key) for key in RUNNER_FIELDS}


def runner_matches(report):
    return runner_identity(report.get("runner", {})) == runner_identity(
        report.get("baseline", BASELINE)["runner"])


def runner_class(report):
    runner = report.get("runner")
    if not runner:
        return "local/unclassified"
    return (f"{runner.get('environment')}/{runner.get('distribution')}-"
            f"{runner.get('osVersion')}/{runner.get('architecture')}/"
            f"{runner.get('logicalCpus')}-vcpu")


def limits(report):
    return report.get("baseline", BASELINE)["limits"]


def number(value, minimum=None):
    if (type(value) not in (int, float) or not math.isfinite(value)
            or (minimum is not None and value < minimum)):
        raise ValueError("Missing or invalid numeric measurement")
    return value


def validate_timing(timing):
    if type(timing["count"]) is not int or timing["count"] < 1:
        raise ValueError("Missing timing samples")
    for stat in STATS:
        number(timing[stat], 0)


def validate(report):
    """Reject incomplete reports instead of displaying missing samples as zero."""
    if report["schemaVersion"] != 1 or type(report["passed"]) is not bool:
        raise ValueError("Unsupported performance report")
    if report["mode"] not in ("sustained", "smoke/custom"):
        raise ValueError("Unknown measurement mode")
    for name in TIMINGS:
        validate_timing(report["timing"][name])
    manual = report["manualBaseline"]
    if type(manual["completedSteps"]) is not int or manual["completedSteps"] < 1:
        raise ValueError("Missing completed manual replay")
    for name in ("physicsStep", "engineStep"):
        validate_timing(manual[name])
        if manual[name]["count"] != manual["completedSteps"]:
            raise ValueError("Manual timing samples do not cover the complete replay")
    gate = report["physicsGate"]
    if (gate["source"] != "manualBaseline.physicsStep"
            or number(gate["limitMs"], 0) != limits(report)["physicsP99Ms"]
            or number(gate["p99Ms"], 0) != manual["physicsStep"]["p99Ms"]):
        raise ValueError("Physics gate must use the manual full-step P99 and configured limit")
    if not report["parameters"] or not isinstance(report["parameters"], dict):
        raise ValueError("Missing applied tuning parameters")
    for value in report["parameters"].values():
        number(value)
    for key in ("parameterFingerprint", "configurationFingerprint"):
        if not re.fullmatch(r"[0-9a-f]{64}", report[key]):
            raise ValueError("Missing configuration identity")
    if not re.fullmatch(r"[0-9a-f]{40}", report["revision"]):
        raise ValueError("Missing measured revision")
    if report.get("runner"):
        runner = report["runner"]
        host = report["host"]
        if (host["logicalCpus"] != runner["logicalCpus"]
                or host["arch"].lower() != str(runner["architecture"]).lower()
                or host["platform"] != {"Linux": "linux", "Windows": "win32",
                                         "macOS": "darwin"}.get(runner["os"])):
            raise ValueError("Measured host disagrees with recorded runner metadata")
    if not isinstance(report["failures"], list):
        raise ValueError("Missing harness failure list")
    if not isinstance(report["scenario"]["name"], str):
        raise ValueError("Missing scenario identity")
    if not isinstance(report["recordedAt"], str):
        raise ValueError("Missing measurement timestamp")
    memory = report["memory"]
    first_time = number(memory["first"]["elapsedSeconds"], 0)
    if number(memory["last"]["elapsedSeconds"], 0) <= first_time:
        raise ValueError("Memory checkpoints are out of order")
    minute_five = memory.get("minuteFive")
    if report["mode"] == "sustained":
        if first_time < 60 or minute_five is None:
            raise ValueError("Sustained report lacks minute-one/minute-five checkpoints")
        if number(minute_five["elapsedSeconds"], 0) < 300:
            raise ValueError("Minute-five checkpoint was captured too early")
    if minute_five is not None:
        if not first_time <= number(minute_five["elapsedSeconds"], 0) <= memory["last"]["elapsedSeconds"]:
            raise ValueError("Minute-five checkpoint is outside the measurement")
        for _, key, _ in HEAPS:
            number(minute_five[key], 0)
    for _, key, growth_key in HEAPS:
        first = number(memory["first"][key], 0)
        last = number(memory["last"][key], 0)
        if first == 0:
            raise ValueError("Invalid zero memory baseline")
        growth = number(memory[growth_key])
        if not math.isclose(growth, (last - first) / first * 100, abs_tol=1e-7):
            raise ValueError("Reported heap growth disagrees with checkpoints")
    if report["passed"] and (report["failures"] or not gates_pass(report)):
        raise ValueError("Report claims success despite a failed design 13.4 gate")
    return report


def gates_pass(report):
    return (report["manualBaseline"]["physicsStep"]["p99Ms"] <= limits(report)["physicsP99Ms"]
            and all(report["memory"][key] <= limits(report)["heapGrowthPercent"]
                    for _, _, key in HEAPS))


def threshold_failure(message, report):
    """Only WP9a's exact numerical failure forms may be skipped on a new class."""
    physics = re.fullmatch(r"Physics p99 ([0-9]+\.[0-9]{3}) ms exceeds ([0-9.]+) ms\.",
                           str(message))
    if physics:
        value = report["manualBaseline"]["physicsStep"]["p99Ms"]
        limit = limits(report)["physicsP99Ms"]
        return (value > limit and float(physics[2]) == limit
                and math.isclose(float(physics[1]), value, rel_tol=0, abs_tol=0.000501))
    heap = re.fullmatch(r"(jsUsedPercent|wasmUsedPercent|wasmCapacityPercent) grew "
                        r"([0-9]+\.[0-9]{2})%, exceeding ([0-9.]+)%\.", str(message))
    if heap:
        value = report["memory"][heap[1]]
        limit = limits(report)["heapGrowthPercent"]
        return (value > limit and float(heap[3]) == limit
                and math.isclose(float(heap[2]), value, rel_tol=0, abs_tol=0.005001))
    return False


def measurement_failed(report):
    code = report.get("harnessExitCode", 0 if report["passed"] else 1)
    return (type(code) is not int or code not in (0, 1)
            or (code == 0) != report["passed"]
            or (not report["passed"] and not report["failures"])
            or any(not threshold_failure(message, report) for message in report["failures"]))


def verdict(report):
    if measurement_failed(report):
        return "FAIL"
    if report["mode"] != "sustained":
        return "SMOKE/CUSTOM" if report["passed"] and gates_pass(report) else "FAIL"
    if report.get("runner") and not runner_matches(report):
        return "GATE SKIPPED"
    return "PASS" if report["passed"] and gates_pass(report) else "FAIL"


def cell(value):
    return html.escape(str(value)).replace("|", "&#124;").replace("\n", " ")


def api(path, binary=False):
    result = subprocess.run(["gh", "api", path], check=True, capture_output=True,
                            timeout=10)
    return result.stdout if binary else json.loads(result.stdout)


def read_archive(raw):
    # Read one bounded JSON member in memory. Never extract or execute artifacts.
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        matches = [item for item in archive.infolist() if item.filename == "perf.json"]
        if len(matches) != 1 or matches[0].file_size > 2 * 1024 * 1024:
            raise ValueError("Missing, duplicated, or oversized historical report")
        return validate(json.loads(archive.read(matches[0])))


def history(current, repository, run_id):
    """Include failed measurements; excluding them would hide regressions."""
    if not current.get("runner"):
        return [], ["Local/unclassified timings must never be compared with hosted history."]
    if not repository or not os.environ.get("GH_TOKEN"):
        return [], ["History unavailable outside an authenticated Actions run."]
    records, notes = [], []
    deadline = time.monotonic() + 45
    endpoint = f"repos/{repository}/actions"
    try:
        runs = api(f"{endpoint}/workflows/performance.yml/runs"
                   "?branch=main&status=completed&per_page=20")["workflow_runs"]
    except (subprocess.SubprocessError, ValueError, KeyError, OSError):
        return [], ["Earlier main history could not be read; current gates still apply."]
    for run in runs:
        if time.monotonic() > deadline:
            notes.append("History lookup time limit reached; current gates still apply.")
            break
        if (str(run["id"]) == run_id or run["conclusion"] == "cancelled"
                or run["head_branch"] != "main"):
            continue
        try:
            artifacts = api(f"{endpoint}/runs/{run['id']}/artifacts")["artifacts"]
            artifact = next((item for item in artifacts
                             if item["name"] == ARTIFACT and not item["expired"]), None)
            if artifact is None:
                continue
            if artifact["size_in_bytes"] > 20 * 1024 * 1024:
                raise ValueError("Oversized historical artifact")
            report = read_archive(api(f"{endpoint}/artifacts/{artifact['id']}/zip",
                                      binary=True))
            if (not report.get("runner") or runner_identity(report["runner"])
                    != runner_identity(current["runner"])):
                raise ValueError("Historical runner class is different or unverified")
            if report["revision"] != run["head_sha"]:
                raise ValueError("Historical revision does not match its workflow run")
            if report["recordedAt"] >= current["recordedAt"]:
                continue
            records.append((report, run["html_url"]))
            if len(records) == 5:
                break
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError,
                zipfile.BadZipFile, OSError):
            notes.append(f"Report for run {run['id']} unavailable or incompatible.")
    return records, notes


def render(report, prior, notes, run_url):
    parameter_id = report["parameterFingerprint"]
    config_id = report["configurationFingerprint"]
    memory = report["memory"]
    manual = report["manualBaseline"]["physicsStep"]
    baseline = report.get("baseline", BASELINE)
    physics_limit = limits(report)["physicsP99Ms"]
    heap_limit = limits(report)["heapGrowthPercent"]
    skip_numeric = bool(report.get("runner")) and not runner_matches(report)
    manual_result = "SKIPPED" if skip_numeric else (
        "PASS" if manual["p99Ms"] <= physics_limit else "FAIL")
    lines = [
        "# Performance measurement",
        "",
        f"**{verdict(report)}** — design 13.4: manual stepMany full physics-step "
        f"configured P99 limit ≤ {physics_limit:g} ms; each heap growth limit ≤ {heap_limit:g}%.",
        "This dedicated workflow does not gate ordinary PR merges.",
        f"Measurement mode: **{cell(report['mode'])}**. "
        "Short/custom runs do not satisfy sustained CI acceptance.",
        "",
        f"Scenario: **{cell(report['scenario']['name'])}**. "
        f"Revision: {cell(report['revision'])}.",
        f"Configuration/input fingerprint: <code>{config_id}</code>.",
        f"Tuning fingerprint: <code>{parameter_id}</code>.",
        f"Runner class: <code>{cell(runner_class(report))}</code>. "
        f"Image version: {cell(report.get('runner', {}).get('imageVersion', 'unclassified'))}. "
        f"CPU: {cell(report.get('host', {}).get('cpu', 'unreported'))}.",
        "**CPU timing is comparable only within the same recorded runner class. "
        "Never compare local CPU timings with GitHub-hosted measurements.** "
        "Use matching configurations and repeated runs; simulation determinism does not "
        "make CPU timing reproducible.",
        f"Recorded hosted baseline: **{baseline['measurement']['physicsP99Ms']:.3f} ms**, "
        f"approximately **{physics_limit / baseline['measurement']['physicsP99Ms']:.1f}×** "
        f"below the configured limit ([source run]({baseline['measurement']['runUrl']})). "
        f"Baseline configuration: <code>{baseline['measurement']['configurationFingerprint']}</code>.",
        "",
        ("**Numerical gates SKIPPED because the runner class changed.** "
         "The measurement is still recorded; malformed reports, incomplete EOF, "
         "and unexpected harness errors still fail. Review a sustained measurement "
         "on the new class before updating .github/performance-baseline.json."
         if skip_numeric else "Numerical gates apply to this measurement."),
        *(["", "| Runner field | Expected baseline | Found |", "| --- | --- | --- |"]
          + [f"| {key} | {cell(baseline['runner'].get(key))} | "
             f"{cell(report['runner'].get(key))} |" for key in RUNNER_FIELDS
             if baseline['runner'].get(key) != report['runner'].get(key)]
          if skip_numeric else []),
        "",
        "## Manual physics gate",
        "",
        f"The configured {physics_limit:g} ms threshold applies only to "
        "<code>manualBaseline.physicsStep.p99Ms</code>, "
        "measured across a complete manual stepMany replay (input, pre-step, engine, "
        "and post-step). Physics state is reproducible; CPU timing can still vary.",
        "",
        "| Measurement | Samples | P99 (ms) | Limit | Result |",
        "| --- | ---: | ---: | ---: | --- |",
        f"| Manual full physics step | {manual['count']} | {manual['p99Ms']:.3f} | "
        f"≤ {physics_limit:g} ms | {manual_result} |",
        "",
        "## Advisory RAF timing distributions",
        "",
        "**All requestAnimationFrame (RAF) distributions below are advisory.** "
        "They do not determine the physics gate or the workflow verdict.",
        "",
        "**Frame-time variance is expected on shared runners.** These values include "
        "browser scheduling and software WebGL. Compare distributions across repeated "
        "runs with the same configuration; a moved frame percentile alone is not a regression.",
        "",
        "| Timing (ms) | Samples | Mean | P50 | P95 | P99 | Min–max | Std. dev. |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key, name in zip(TIMINGS, ("Frame", "Full physics step", "Jolt engine step")):
        t = report["timing"][key]
        lines.append(f"| {name} | {t['count']} | {t['meanMs']:.3f} | "
                     f"{t['p50Ms']:.3f} | {t['p95Ms']:.3f} | {t['p99Ms']:.3f} | "
                     f"{t['minMs']:.3f}–{t['maxMs']:.3f} | "
                     f"{t['standardDeviationMs']:.3f} |")
    lines += [
        "",
        "## Heap checkpoints",
        "",
        f"Actual checkpoint times: {memory['first']['elapsedSeconds']:.2f}s → "
        f"{memory['last']['elapsedSeconds']:.2f}s (final replay EOF). "
        "JS values are retained heap after GC. Growth gates compare first to final EOF; "
        "the minute-five snapshot is shown separately.",
        "",
        "| Heap | First (MiB) | Minute five (MiB) | Final EOF (MiB) | Growth | Gate |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, key, growth in HEAPS:
        minute_five = memory.get("minuteFive")
        five = f"{minute_five[key] / 2**20:.3f}" if minute_five else "unavailable"
        lines.append(f"| {name} | {memory['first'][key] / 2**20:.3f} | "
                     f"{five} | {memory['last'][key] / 2**20:.3f} | "
                     f"{memory[growth]:+.3f}% | "
                     f"{'SKIPPED' if skip_numeric else f'≤ {heap_limit:g}%'} |")
    lines += ["", "## Current and earlier main measurements", "",
              "Current measurement plus up to five retained earlier main reports from "
              "the same recorded runner class, including failures and skipped gates. "
              "Different configuration fingerprints are not directly comparable. "
              "Each linked run retains its full parameters and raw report.",
              "",
              "| Run (UTC) | Commit | Config | Manual physics P99 ms | "
              "Advisory RAF frame P50 / P95 / P99 ms | Heap growth JS / WASM used / capacity | Result |",
              "| --- | --- | --- | ---: | ---: | ---: | --- |"]
    for item, url in [(report, run_url), *prior]:
        frame = item["timing"]["frame"]
        growth = " / ".join(f"{item['memory'][key]:+.2f}%"
                            for _, _, key in HEAPS)
        lines.append(f"| [{cell(item['recordedAt'])}]({url}) | "
                     f"{item['revision'][:8]} | {item['configurationFingerprint'][:12]} | "
                     f"{item['manualBaseline']['physicsStep']['p99Ms']:.3f} | "
                     f"{frame['p50Ms']:.2f} / {frame['p95Ms']:.2f} / "
                     f"{frame['p99Ms']:.2f} | {growth} | {verdict(item)} |")
    lines += [""] + [cell(note) for note in notes]
    if not prior:
        lines += ["No retained earlier main measurement is available yet."]
    if report["failures"]:
        lines += ["", "## Harness failures", ""]
        lines += [f"- {cell(failure)}" for failure in report["failures"]]
    for title, value in (
        ("Applied tuning parameters", report["parameters"]),
        ("Scenario, run configuration, and host",
         {key: report.get(key) for key in
          ("scenario", "scenarioFingerprint", "inputIdentity", "replay", "config",
           "runner", "baseline", "harnessExitCode", "host", "browser", "viewport",
           "mode", "worktreeDirty")}),
    ):
        # Escape HTML and prevent data from terminating the fenced block.
        data = html.escape(json.dumps(value, sort_keys=True, indent=2)).replace(
            FENCE, "&#96;&#96;&#96;")
        lines += ["", f"<details><summary>{title}</summary>", "",
                  "<pre>", data, "</pre>", "", "</details>"]
    return "\n".join(lines) + "\n"


def write_summary(markdown):
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY.write_text(markdown)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(markdown)


def main():
    try:
        runner = observed_runner() if os.environ.get("GITHUB_ACTIONS") == "true" else None
        report = json.loads(REPORT.read_text())
        if runner is not None:
            report["runner"] = runner
            report["baseline"] = BASELINE
            report["harnessExitCode"] = int(EXIT_CODE.read_text().strip())
        report = validate(report)
        if runner is not None:
            # Preserve every harness measurement; append runner/baseline and process status.
            REPORT.write_text(json.dumps(report, indent=2) + "\n")
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        run_url = (f"https://github.com/{repository}/actions/runs/{run_id}"
                   if repository and run_id else "#")
        prior, notes = history(report, repository, run_id)
        write_summary(render(report, prior, notes, run_url))
        return 0 if verdict(report) in ("PASS", "GATE SKIPPED") else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        write_summary("# Performance measurement unavailable\n\n"
                      "**FAIL** — no complete, valid report was produced. "
                      "Inspect the harness step and retained perf-console.log. "
                      "Missing measurements are not treated as zero or as a pass.\n\n"
                      f"Reason: {cell(error)}\n")
        print("::error::Missing or invalid performance report")
        return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--configuration"]:
        label = BASELINE["runner"]["label"]
        if not re.fullmatch(r"[A-Za-z0-9._-]+", label):
            raise ValueError("Invalid baseline runner label")
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"runner={label}\n")
            output.write(f"physics_limit={number(BASELINE['limits']['physicsP99Ms'], 0)}\n")
            output.write(f"heap_limit={number(BASELINE['limits']['heapGrowthPercent'], 0)}\n")
    elif sys.argv[1:] == ["--record-runner"]:
        runner = observed_runner()
        print(json.dumps({"expected": BASELINE["runner"], "found": runner}, indent=2))
        if not runner_matches({"runner": runner}):
            print("::notice::Runner class changed; measurements will be recorded with "
                  "numerical gates skipped. Measurement integrity failures still fail.")
    else:
        raise SystemExit(main())

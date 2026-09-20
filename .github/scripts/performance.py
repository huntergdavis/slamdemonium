"""Summarize WP9a reports and recent main measurements without repository writes."""

import html
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import zipfile


REPORT = Path("test-results/perf.json")
SUMMARY = Path("test-results/perf-summary.md")
ARTIFACT = "performance-results"
TIMINGS = ("frame", "physicsStep", "engineStep")
STATS = ("meanMs", "p50Ms", "p95Ms", "p99Ms", "minMs", "maxMs",
         "standardDeviationMs")
HEAPS = (("JS retained", "jsUsedBytes", "jsUsedPercent"),
         ("WASM used", "wasmUsedBytes", "wasmUsedPercent"),
         ("WASM capacity", "wasmHeapBytes", "wasmCapacityPercent"))
FENCE = chr(96) * 3


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
            or number(gate["limitMs"], 0) != 2
            or number(gate["p99Ms"], 0) != manual["physicsStep"]["p99Ms"]):
        raise ValueError("Physics gate must use the manual full-step P99 with a 2 ms limit")
    if not report["parameters"] or not isinstance(report["parameters"], dict):
        raise ValueError("Missing applied tuning parameters")
    for value in report["parameters"].values():
        number(value)
    for key in ("parameterFingerprint", "configurationFingerprint"):
        if not re.fullmatch(r"[0-9a-f]{64}", report[key]):
            raise ValueError("Missing configuration identity")
    if not re.fullmatch(r"[0-9a-f]{40}", report["revision"]):
        raise ValueError("Missing measured revision")
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
    return (report["manualBaseline"]["physicsStep"]["p99Ms"] <= 2
            and all(report["memory"][key] <= 10 for _, _, key in HEAPS))


def verdict(report):
    if not report["passed"] or not gates_pass(report):
        return "FAIL"
    return "PASS" if report["mode"] == "sustained" else "SMOKE/CUSTOM"


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
    lines = [
        "# Performance measurement",
        "",
        f"**{verdict(report)}** — design 13.4: manual stepMany full physics-step "
        "P99 ≤ 2 ms; each measured heap growth ≤ 10%.",
        "This dedicated workflow does not gate ordinary PR merges.",
        f"Measurement mode: **{cell(report['mode'])}**. "
        "Short/custom runs do not satisfy sustained CI acceptance.",
        "",
        f"Scenario: **{cell(report['scenario']['name'])}**. "
        f"Revision: {cell(report['revision'])}.",
        f"Configuration/input fingerprint: <code>{config_id}</code>.",
        f"Tuning fingerprint: <code>{parameter_id}</code>.",
        "",
        "## Manual physics gate",
        "",
        "The 2 ms threshold applies only to <code>manualBaseline.physicsStep.p99Ms</code>, "
        "measured across a complete manual stepMany replay (input, pre-step, engine, "
        "and post-step). Physics state is reproducible; CPU timing can still vary.",
        "",
        "| Measurement | Samples | P99 (ms) | Limit | Result |",
        "| --- | ---: | ---: | ---: | --- |",
        f"| Manual full physics step | {manual['count']} | {manual['p99Ms']:.3f} | "
        f"≤ 2 ms | {'PASS' if manual['p99Ms'] <= 2 else 'FAIL'} |",
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
        "| Heap | First (MiB) | Minute five (MiB) | Final EOF (MiB) | Growth | Limit |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, key, growth in HEAPS:
        minute_five = memory.get("minuteFive")
        five = f"{minute_five[key] / 2**20:.3f}" if minute_five else "unavailable"
        lines.append(f"| {name} | {memory['first'][key] / 2**20:.3f} | "
                     f"{five} | {memory['last'][key] / 2**20:.3f} | "
                     f"{memory[growth]:+.3f}% | ≤ 10% |")
    lines += ["", "## Recent main measurements", "",
              "Up to five retained earlier main reports, including failures. "
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
           "host", "browser", "viewport", "mode", "worktreeDirty")}),
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
        report = validate(json.loads(REPORT.read_text()))
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        run_url = (f"https://github.com/{repository}/actions/runs/{run_id}"
                   if repository and run_id else "#")
        prior, notes = history(report, repository, run_id)
        write_summary(render(report, prior, notes, run_url))
        return 0 if verdict(report) == "PASS" else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        write_summary("# Performance measurement unavailable\n\n"
                      "**FAIL** — no complete, valid report was produced. "
                      "Inspect the harness step and retained perf-console.log. "
                      "Missing measurements are not treated as zero or as a pass.\n\n"
                      f"Reason: {cell(error)}\n")
        print("::error::Missing or invalid performance report")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

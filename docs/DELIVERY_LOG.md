# Delivery log and estimation

Derived from merged pull request history, not from estimates. Regenerate the
numbers with the queries in "Method" below.

## Observed cycle time per work item

"Work time" is measured from an agent's previous merge to the creation of their
next pull request: the window in which they were actually building the next
thing. Outliers above four hours are excluded as idle gaps, not work.

| Agent | Items measured | Median | Mean | Max |
|---|---:|---:|---:|---:|
| Technical writer | 12 | 3 min | 12 min | 79 min |
| Research | 6 | 12 min | 24 min | 92 min |
| Designer | 8 | 22 min | 20 min | 37 min |
| Developer 2 | 5 | 26 min | 25 min | 41 min |
| Developer 1 | 4 | 31 min | 28 min | 31 min |
| DevOps | 3 | 37 min | 51 min | 80 min |
| **Team** | **38** | **18 min** | **22 min** | p90 **41 min** |

## What the numbers mean

- **Documentation is roughly ten times faster than infrastructure.** A docs item
  lands in minutes; a CI or deployment item takes half an hour or more because
  it is validated against real hosted runs rather than unit tests.
- **The three code roles cluster tightly**, 22 to 31 minutes median. Use ~30 min
  for a scoped code work package with tests.
- **Pull-request-open to merge is not a useful metric here** (median 2 min). It
  measures PM merge latency, not delivery.
- **Variance comes from validation, not authoring.** The long tails are agents
  refusing to count timed-out or unvalidated runs and re-running them.

## Estimating

For a scoped item with tests, assume **30 minutes** of agent time, **45 minutes**
at p90. Add for:

| Factor | Add |
|---|---|
| Touches CI, deploys, or hosted validation | +30 min |
| Requires a contract agreed with another agent first | +15 min |
| Cross-agent integration (mounting, wiring) | +30 min, and expect a second pass |
| Docs only | subtract; assume 5 min |

Parallelism is real: 49 pull requests merged in 3.2 hours of wall clock across
six agents. Throughput is bounded by the critical path and by review, not by
individual agent speed.

## Known estimation failure

Every individual package can be complete, tested and green while the assembled
product does not work. The Options panel, HUD, scripted input and persistence
were all merged and unreachable from the boot path. **Budget an explicit
integration item** at the end of any multi-agent feature; do not treat the sum
of merged packages as a working product. `npm run check:reachable` now guards
this class of defect.

## Method

```sh
gh pr list --state merged --limit 200 \
  --json number,title,headRefName,createdAt,mergedAt
```

Group by branch prefix (`dev1/`, `dev2/`, `design/`, `research/`, `docs/`,
`devops/`), then measure previous-merge to next-creation per agent.

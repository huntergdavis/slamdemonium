# Releases and build identity

Production at <https://hunterdavis.com/slamdemonium/> serves the **last successfully deployed stable release**. Main is continuously playable at <https://hunterdavis.com/slamdemonium/main/> with an **UNRELEASED MAIN PREVIEW** banner. PR previews retain their existing `/pr/<number>/` URLs and independent CI caveat.

GitHub Pages continues to use **GitHub Actions** and the existing **main-only `github-pages` environment**. The `gh-pages` branch stores PR previews only; it never supplies production files. Production comes from a retained GitHub release asset, validated against the immutable tag, embedded commit and GitHub asset checksum. Until the first release succeeds, [release-bootstrap.json](release-bootstrap.json) pins the previously verified live source so merging the mechanism cannot silently advance production.

## One-command cut

After the PM merges the intended phase and **CI**, **Reachability** and **Bundle size** are green for that main commit:

```sh
gh workflow run pages.yml --repo huntergdavis/slamdemonium --ref main -f release=true
```

The command starts **Deploy Pages**. Its main-only dispatch captures an exact main commit. Watch its run and summary in Actions; command acceptance alone does not mean the release is live. The PM should notify anyone actively playtesting production before running it.

1. Validate the three required checks and matching package/lock versions. Build an unreleased main preview plus release artifacts for production and the isolated `/release-candidate/` base path, using read-only permissions.
2. Deploy the candidate alongside the **unchanged** production root. Verify the candidate's identity, asset paths and every served file; also verify every existing production file remains byte-identical.
3. Create `vX.Y.Z` at the captured source and a draft GitHub release with generated notes from merged PRs. Retain the exact production ZIP and verify its checksum. Existing tags and assets are never moved or overwritten.
4. Promote production last. Verify every production file byte-for-byte, then publish the release and make it latest. If promotion or verification fails, restore the prior complete Pages artifact and verify the restoration.

The whole workflow shares the Pages concurrency group; active publications finish without cancellation. Thus PR updates and main pushes cannot interleave with a release cut. The privileged publisher checks out only the captured trusted main commit. All application artifacts, including PR outputs, are treated strictly as static bytes and never executed there. The read-only CI run supplies browser behavior coverage; deployed-file verification proves identity, delivery and base-path integrity, not a new network-profile or real-device performance result.

GitHub-generated release notes include merged PR titles, contributors and a comparison link. `production.zip` is attached to the release rather than depending on expiring Actions artifacts. Release creation is explicit in the same workflow: a tag created with `GITHUB_TOKEN` does not implicitly trigger another tag-push workflow. See GitHub's [generated notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes) and [workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The retained ZIP also carries earlier content-hashed `assets/` files so cached HTML and already-open games can finish loading across a cutover. Staging adds the new hashed asset URLs without replacing old entry points, so the rollback artifact can serve either generation of cached HTML. Current HTML and build identity always come from the selected production build. Retained assets accumulate within the existing 250 MiB / 10,000-file archive bounds; a hash collision fails before promotion. Future changing public assets should use versioned URLs. The bundle budget measures the current build, while these compatibility files increase storage without adding requests to the current game's asset graph.

## Version authority and player-visible identity

`package.json` is the version authority; both root versions in `package-lock.json` must match. Versions use stable semantic `X.Y.Z`; tags use matching `vX.Y.Z`. To prepare the next phase in its reviewed PR:

```sh
npm version 0.2.0 --no-git-tag-version --ignore-scripts
```

Commit both package files. Cutting again without a version increase fails. Do not push tags manually, move an existing tag or edit a published release asset to change production. The cut command creates the matching tag and release together.

Every build emits deterministic `build-info.json` containing the version, full and short source commit, channel and label. The pause menu shows that same label: **RELEASE v0.1.0 · shortSHA** or **UNRELEASED · v0.1.0 · shortSHA**. Ordinary main, PR and local builds always say **UNRELEASED**, even on an otherwise tagged commit; modified local checkouts also say `-dirty`. Only the explicit clean release build receives the stable label. PR builds identify their tested merge commit; the sticky comment separately identifies the proposed branch head.

The menu receives a preformatted optional `buildLabel`, renders it once as text, and adds no focus target or work to the frame loop. The visible identity and JSON are checked together in the production-build browser smoke.

## Failed cuts and recovery

Before promotion, any failure leaves production unchanged. A failed cut may leave a matching tag and draft release; **rerun that same workflow run at the same captured commit** after investigating the failure. The workflow accepts an identical draft asset and refuses a different one. Do not dispatch a changed main commit at an already-created version: commit a new version instead. A published version is not recut.

If automatic rollback also fails, the run is red and production must be checked directly; the workflow never reports a successful release in that state. An ordinary main publication restores the last published stable release. Fix or revert through a reviewed PR and cut a new semantic version; tags remain immutable. The candidate URL is temporary and may disappear on the next ordinary publication. Main and PR previews remain available independently of release success.

Release mechanics have deterministic tests under `.github/tests`, run by existing CI; they introduce no new required check or branch-protection change. Local checks:

```sh
python3 -m unittest discover -s .github/tests -v
npm test -- tests/build-info.test.ts
VITE_BASE_PATH=/slamdemonium/ npm run e2e -- e2e/boot.spec.ts
```

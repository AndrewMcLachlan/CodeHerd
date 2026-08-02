# Release smoke-test checklist

Run this checklist against the packaged build (not `npm start`) on every
supported platform before publishing a release, with **each installed agent**
(Claude Code, and Codex where available). Record the OS version, CodeHerd
version, and agent CLI versions (`claude --version`, `codex --version`) in the
release notes.

A platform ships as **verified** only when every item passes; otherwise it is
marked **experimental** in the release notes.

## Install and launch

- [ ] Fresh install following [INSTALL.md](INSTALL.md), including the
      documented SmartScreen/Gatekeeper path
- [ ] App launches with no prior state (clean `~/.codeherd`)
- [ ] Install over the previous release preserves tabs, recently closed
      sessions, preferences, colours, and the active tab

## Agent detection

- [ ] Installed agents are detected (New Tab offers each of them)
- [ ] With an agent removed from PATH, the app warns instead of failing

## Sessions

- [ ] New session starts in a picked folder
- [ ] Session list shows resumable sessions for that folder with sensible
      labels (no slash-command labels)
- [ ] Resuming a listed session restores the conversation
- [ ] Quit and relaunch: open tabs are restored to the same sessions
- [ ] `/clear` (Claude): tab tracks the new session id (quit/relaunch resumes
      the post-clear conversation)

## Terminal interaction

- [ ] Copy from the terminal (selection) and paste into it
- [ ] Multi-line paste arrives as one block (no per-line execution)
- [ ] Image paste (Alt+V) reaches Claude where supported

## Metadata and indicators

- [ ] `/rename` updates the tab label; `/color` updates the tab colour; both
      survive a restart
- [ ] Working indicator shows while the agent is busy
- [ ] Attention pulse shows on permission prompts **and** question prompts
      (AskUserQuestion select lists)
- [ ] Status bar shows model, context %, and effort for the active tab

## Shutdown

- [ ] Closing a tab ends its agent process (verify in the OS process list)
- [ ] Quitting the app with live tabs exits within ~5 seconds and leaves no
      orphaned agent processes
- [ ] Relaunch after quit restores the previously open tabs

## Release artifacts (once per release, any platform)

- [ ] Prepare Release passed its artifact-verification step
- [ ] `SHA256SUMS` verifies against a downloaded artifact
- [ ] `gh attestation verify <artifact> --repo AndrewMcLachlan/CodeHerd` passes
- [ ] Release notes list supported agents, platforms, installation caveats,
      and known limitations

## Cutting the release

Pushing a tag does **not** release. Tags are protected by the *Version tags*
ruleset and can only be created by a repository admin or maintainer — which in
practice means by publishing a draft release. That is the single human gate on
the pipeline, and it comes after the artifacts exist.

1. **Bump `version` in `package.json`** on `main` and let CI go green.
   Use the Squirrel-safe scheme — `1.0.0-beta2`, not `1.0.0-beta.2` — because
   Squirrel strips dots from prerelease identifiers. A hyphen anywhere in the
   version marks the release as a pre-release automatically, keeping it out of
   `/releases/latest` so stable users are not notified about it.
2. **Run the *Prepare Release* workflow** from `main`. It refuses to run if the
   tag or a release for it already exists, or if the platform builds were not
   green for that commit. It then rebuilds every platform from that checkout,
   verifies each expected artifact is present and carries the right version,
   writes `SHA256SUMS`, attests build provenance, and attaches everything to a
   **draft** release. No tag exists yet and users cannot see it.
3. **Smoke test the draft's artifacts** using this checklist. A bad draft is
   deleted — nothing has been released.
4. **Publish the draft.** This mints the tag and makes the release live. Check
   the pre-release box is in the state you expect before publishing.
5. **Confirm the *Release* workflow is green.** It re-verifies the published
   release: tag matches `package.json`, the commit is an ancestor of `main`,
   the pre-release flag matches the version, and every expected asset is
   attached. It publishes nothing — a failure means go and look at the release,
   not that the release failed.

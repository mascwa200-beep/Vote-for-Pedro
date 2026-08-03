## What changed

<!-- What this does, and why. Lead with the behaviour, not the file list. -->

## How it was verified

<!--
Say what you actually ran, not what you believe. If a claim is testable,
point at the test that tests it.
-->

- [ ] `npm test` passes
- [ ] `node tools/verify-app.mjs` passes (browser + offline proof)
- [ ] `npm run build` run and `dist/` committed, if the bundle changed
- [ ] `./tools/build-apk.sh` run, if anything under `android/` changed

## Things this project does not do

Check these still hold, or say plainly which one you changed and why:

- [ ] No runtime dependencies, and no build step required to play
- [ ] No network calls — the game works with the radio off, permanently
- [ ] No audio files; every sound is synthesized at runtime
- [ ] No copyrighted material from the shows is reproduced

## Balance

<!--
Only if combat, difficulty, or ship data changed. `tests/balance.test.js`
simulates hundreds of engagements — say what moved and whether the curve
still holds at both ends of the ladder.
-->

N/A

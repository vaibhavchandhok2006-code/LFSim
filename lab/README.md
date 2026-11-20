# LFSim Lab

Finds the best Robo-Run line follower by testing designs on many tracks without a browser. Spec:
[LFSim Lab — Spec v1](https://claude.ai/artifact/7noPMWNsUYry7sCm8jCajX).

Status: **Phase 0 done** — the simulator runs from the command line with the same results as the website.
Next: Phase 1 (track generator, full 10-minute session benchmark).

```
npm run lab -- help
npm run lab -- doctor                                   # check Node, Git, gcc, Claude Code
npm run lab -- run --project my.lfsim.json --seconds 120 --csv run.csv --json run.json
npm run lab -- run --track public/samples/roborun-sample.png --robot my.robot.json
```

Windows setup: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

| Folder | Holds |
| --- | --- |
| `src/cli.ts` | Command line (`run`, `doctor`) |
| `src/inputs.ts` | Reads project / track / robot files (validated like the website) |
| `src/headless.ts` | Runs the website's simulation Engine without a browser |
| `src/image.ts` | PNG decoding in Node |
| `src/doctor.ts` | Setup checks with fixes |

The simulator code is shared with the website (`src/`); the track is built by `src/track/buildTrack.ts` in both.

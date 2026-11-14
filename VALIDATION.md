# Validation

Results recorded only after running. Command: `npm test`.

## Physics (src/sim/physics.test.ts) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| Straight-line top speed vs motor maths | within 85–101% | pass (1.493 m/s vs 1.495 nominal) |
| Equal motors drive straight | heading < 0.001 rad after 2 s | pass |
| Weaker right motor curves right | heading > 0.01 rad | pass |
| Spin rate vs wheelbase | within 5% | pass |
| 0 → 90% speed | < 0.5 s | pass |

## Track import (src/track/importTrack.test.ts) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| EDT exact distances | exact | pass |
| Robo-Run sample scaled | 1250 × 1250 px at 2 mm | pass |
| Line width measured | 2–4.5 cm | pass (2.6 cm) |
| Start top-left, finish bottom-right | detected | pass |
| Line normalised to 3.8 cm | 3.4–4.2 cm | pass |

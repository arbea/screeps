# Changelog

One line per change, saying what it was for. The source is the detail.

Anything before 2026-07-26 is in `git log`. `screeps-dashboard/` is not tracked by git, so its
changes are recorded only here.

## 2026-07-26

- Confine harvesting to dedicated miners; no other role earns energy at a source any more.
- Make config.js constants only; behaviour changes by editing code and deploying, not from Memory.
- Drop the dashboard's knob panel, so no setting has two places it can come from.
- Surface what the bot already computed and never showed: CPU tier, bucket ceiling, active haulers, controller progress.
- Name every task type once, after half of them had been rendering as `undefined`.
- Put the room's structures on the minimap.
- Poll Screeps only while somebody is watching; the timer alone spent twelve days of API quota a day.
- Stop treating a regenerating source as one that has ceased to exist.
- Let miners stand on their square rather than beside it.
- Skip spawn requests whose body the room cannot afford.
- Score only rooms surveyed first-hand, since an ally's report carries no source list.

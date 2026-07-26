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
- Answer dashboard messages from the terminal session that has the context, not a cold one per message.
- Rebuild the dashboard phone-first: bottom tabs, one view at a time, chat first, unread dot.
- Keep a chat message in the box when the send fails, instead of clearing it and losing it.
- Rebuild again as three swipeable pages - chat, map, goals/log - with arrows for the desk.
- Count every Screeps API call against its published limit, since the responses carry no headers.
- Route terminal-side Screeps calls through screeps-call.js so the meter can see them.
- Measure AI usage from session transcripts and stand down at 85% until the window resets.
- Book what each source still held when it regenerated - energy produced and never collected.
- Move screeps-call.js under tools/ so the game's folder sync stops uploading it as a module.
- Show controller level, upgrade rate and the structure caps the level allows, so "at cap" is visible.
- Time the shard rather than assuming, so a tick count can be stated in hours.
- Throttle autonomous work by burn-rate pressure instead of stopping dead at 85%.
- Watch the throttle tier from outside the session, since a stopped session cannot restart itself.
- Show the last message an ally actually sent, and how many ticks ago it arrived.
- Add a fourth page for reconciling with the ally, with a box that queues into the protocol outbox.

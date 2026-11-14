# Simulations (system tests)

These scripts run whole school days through the real rules in `src/engine.js`, with no internet:
a fake clock, the sample school, and a recorder instead of Firestore.

- `day-flow.test.mjs`: gate scans, the teacher's confirmation, the parent texts and their timing,
  late arrivals, a child scanned but not in class, a class nobody confirms, old-day corrections.
- `admin-and-parents.test.mjs`: moving a child to another section, changing a guardian's number,
  cancelled classes, excuse requests, subject teachers, housekeeping.

Run them from the project folder:

    node --import ./worker/resolve-hook.mjs tests/day-flow.test.mjs
    node --import ./worker/resolve-hook.mjs tests/admin-and-parents.test.mjs

Each line starts with `ok` or `FAULT`. The Worker has its own test: `cd worker && npm test`.

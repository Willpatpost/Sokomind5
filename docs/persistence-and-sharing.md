# Persistence and sharing

Sokomind remains account-free and server-free. Attempts, personal bests, and
experience preferences are stored only in the current browser unless the user
chooses to export or share them.

## Storage records

All keys are namespaced because GitHub project pages under one user domain
share a Web Storage origin:

- `sokomind.session.v1` — current puzzle plus its canonical action log;
- `sokomind.progress.v1` — best completed route per puzzle;
- `sokomind.experience.v1` — audio, volume, and motion preferences.

The storage adapter catches unavailable-storage and quota errors. Earlier
unnamespaced prototype values are read once for compatibility and copied into
the namespaced records when storage permits.

## Exact attempt recovery

The session record never stores trusted coordinates. It stores a puzzle ID and
compact `U`, `D`, `L`, and `R` actions. Recovery resolves the current catalog
puzzle and replays every action through the core transition. An unknown puzzle,
invalid character, excessive log, or blocked action fails closed to a clean
room.

This same replay rule is used for shared solution fragments and solver result
verification. There is only one definition of a legal player transition.

## URLs and browser history

Puzzle routes use a GitHub Pages-safe hash:

```text
#puzzle=huge
#puzzle=ultra-tiny&play=D
```

Selecting a puzzle adds a browser-history entry. A Share action includes the
current route when it is at most 8,000 actions; longer attempts share the
puzzle only. Loading an edited or illegal replay still opens the named puzzle
but never trusts the bad state.

## Progress backups

The Progress dialog exports readable versioned JSON. Import validates the
schema and merges records rather than replacing them. The better record is the
one with fewer moves, and its original completion timestamp is preserved.

Reset progress removes completed personal bests from the active application
state after an explicit confirmation. It does not change the current attempt
or experience preferences.

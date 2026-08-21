---
name: document
description: |
  Documentation philosophy: explain why, not what. Captures non-obvious invariants, 
  physical failure modes, and discarded alternatives across Rust, Go, TypeScript, and docs.
---

# document

Documentation is the durable capture of non-obvious invariants at the point of change.
If a comment merely restates what the types, signatures, or function names already show,
delete it.

## 1. The Tri-Fold Invariant Filter

Before writing or keeping documentation, ensure it answers at least one of these three
non-obvious pillars:

1. **The 'Why' (Domain Intent & Constraints)**:
   The business rule, external constraint, or user contract that forced this specific
   design over a naive one.
2. **The 'Invariant' (Physical & Runtime Physics)**:
   Ordering requirements, concurrency/lock boundaries, panic conditions, memory/resource
   lifetimes, or performance cliffs that the compiler/type system cannot enforce.
3. **The 'Negative Space' (Discarded Alternatives)**:
   The one-sentence reason why the obvious or standard approach was deliberately rejected,
   preventing future maintainers (and agents) from refactoring the bug back in.

## 2. Point-of-Change Workflow

1. **On Mutation**: While modifying or designing code, observe the hidden assumptions in
   your current thought process.
2. **Distill**: Compress that transient reasoning into a single durable invariant sentence
   at the definition site.
3. **Zero Restatement**: Delete anything the identifier name, parameter types, or return
   signature already communicate.
4. **Prune**: Erase all scratchpads and temporary explanations upon task completion.
   Durable knowledge lives only in code docstrings and project documentation.

## 3. Polyglot Idioms & Tooling Conventions

Respect host ecosystem conventions and linters (godoc, rustdoc, JSDoc). Match the
language's native formatting while preserving terse, unslop phrasing.

### Rust (`///`, `//!`)

- Follow standard rustdoc section conventions (`# Panics`, `# Safety`, `# Errors`).
- Document non-obvious invariants, unsafe pre-conditions, and allocation/lock behaviors.

```rust
/// Spawns the worker pool with pinned OS threads.
///
/// # Panics
/// Panics if called outside the main thread runtime context, as thread
/// affinity binding requires root-level process masks.
///
/// # Discarded Alternatives
/// Uses `crossbeam-channel` instead of `tokio::sync::mpsc` to prevent
/// async scheduler latency spikes during audio buffer flushing.
```

### Go (`//`)

- Must start with the exported symbol name to satisfy `revive` / `golint` / `godoc`.
- Document ordering, concurrency guarantees, and memory ownership (e.g. caller vs callee
  buffer reuse).

```go
// Rebalance partitions among active consumers.
//
// Caller owns the returned slice; mutating it does not affect internal ring state.
// Safe for concurrent calls, but blocks active consumer reads until the epoch advances.
```

### TypeScript / JavaScript (`/** */`)

- Document context shadowing, DOM focus loops, and dynamic runtime invariants that
  TypeScript's structural type system cannot narrow.

```typescript
/**
 * Blocks CompositeContext so nested Lists establish isolated keyboard focus loops.
 * Essential for popover menus; without this, nested items join the parent menu's navigation.
 */
```

## 4. What to Delete (Zero Tolerance for Slop)

- **Trivial restatements**: `// renders a button`, `// creates a new user`.
- **Type echoes**: `// @param userId - the user id as a string`.
- **Mechanism narrations**: Explaining line-by-line syntax instead of system consequence.
- **Vague filler**: `// helper function`, `// handles business logic`.

---
name: write-discoverable-code
description: |
  Rules for writing code that coding agents (and humans) can find and understand through
  plain-text search. Apply whenever writing or renaming code: functions, types, constants,
  files, error messages, doc comments.

  Grounded in measurement: agents navigate by plain-text search, not by AST or
  language server, so every identifier is a search query and every search miss
  costs wasted reads.
---

# Write discoverable code

Coding agents discover code by searching for strings and reading small windows around the
hits. They have no hover text, no jump-to-definition, and no memory between sessions. These
rules make code resolvable in one search instead of five.

## 1. Names are search queries — progressive disclosure via modules

- **Use the module namespace as the domain qualifier.** Symbols are named relative to
  their enclosing module. The module supplies the domain context; the symbol supplies the
  action and object. `users::diff_objects`, not `users::diff_user_objects` (stutter) and
  not `users::diff` (bare verb, ambiguous within the module surface).
  Rust: `users::get_by_id`. Go: `user.GetByID`. TS: `import * as users` → `users.getById`.
- **No stutter.** Never repeat the module/package name in the exported symbol.
  `user.New()` not `user.NewUser()`. `auth::validate_token` not `auth::validate_auth_token`.
- **No bare verbs.** A single verb without its object is ambiguous even inside a namespace.
  `users::get` — get what? `users::get_by_id` — clear. Qualify the action until it is
  unambiguous within the module's public surface, then stop.
- **Qualify only as far as uniqueness requires.** If `get_by_id` is unambiguous inside
  `users`, stop there. If the module exports both `get_by_id` and `get_by_email`, both
  are sufficiently qualified. Never add words that the module path already provides.
- **One concept, one spelling.** Pick `organizationId` or `orgId` and use it everywhere;
  every synonym splits every future search in half. Reuse existing vocabulary in the
  codebase you are editing rather than introducing near-synonyms.
- **When behavior or audience changes, rename in the same commit.** A stale name is
  misinformation with a 100% open rate — that includes visibility markers: a `_private`
  helper that other modules now import needs a public name.
- **One definition site per symbol.** Never duplicate an implementation across files.
  Re-export entry points are pointers, not copies: Rust `pub use`, Go package-level type
  aliases, and TS barrel `index.ts` files are acceptable because they point to a single
  canonical definition. Duplicated *implementations* are never acceptable.
- **Filenames follow the same namespacing rule.** When a directory provides the domain
  namespace, the filename provides the concept: `billing/config.ts` is fine because
  `billing/` qualifies it. A bare `config.ts`, `types.ts`, `utils.ts`, or `helpers.ts`
  at a project root or shared directory — with no enclosing namespace — says nothing in a
  search result and collides with every other module's config/types. Ban bare-role
  filenames only when there is no enclosing namespace directory.

## 2. Types are the documentation agents can't skip

Three universal type invariants that make illegal states unrepresentable:

- **Newtypes / nominal identity for primitive IDs.** Argument transposition must be a
  compile error, not an invisible runtime bug.
  Rust: `struct UserId(String);`. Go: `type UserID string`. TS: `Brand<string, 'UserId'>`.
- **Capability tokens for privileged operations.** A comment is a request; a required
  type is physics. Require an explicit capability to call dangerous functions.
  Rust: `&mut Transaction<'_>`. Go: `TxContext`. TS: `AuthenticatedSession`.
- **Exhaustive state via discriminated unions.** Model state transitions as closed
  enums, not clusters of nullable fields with implicit rules.
  Rust: `enum OrderState { Draft, Confirmed, Shipped }`.
  Go: sealed interface with unexported marker method.
  TS: `type State = { kind: "draft" } | { kind: "confirmed", at: Date }`.
- **Name types like they'll be quoted back** — they will be, in compiler errors the
  agent uses to self-correct. `OrgScopedDb` explains itself; `Ctx2` does not.

## 3. Say it where the search lands

- **One-line doc comment on every export**, stating the sharpest constraint the code
  itself can't show (units, timezone, "source time, not insert time", ownership).
  The definition is where a name search lands; that line is your whole message.
- **Write the plain-words phrase in the doc comment.** Searches arrive as natural
  language ("rate limit", "retry delay"), and `camelCase` / `snake_case` identifiers
  don't match phrase greps. The doc comment must contain the un-cased natural phrase
  someone would search for: `SessionExpiryChecker` needs `/// Checks whether the user
  session has expired` so a grep for "session expired" lands here.
- **A module should make sense with its imports unread.** Each imported name plus its
  doc line should say enough that the reader never has to open the source module.
- **Keep strings whole.** Never build event names, flags, or error codes with template
  interpolation (`` `github.${entity}.${action}` `` makes `github.pr.merged` unsearchable).
  Write the full literal even when a loop feels DRYer.
- **One searchable concept per file, and keep orchestrators thin.** The code that
  answers "where is X done?" should live in a module named after X. An orchestrator
  should read as a sequence of calls into well-named modules; if a reader lands in it
  from a search, every line should point them one hop from the real implementation.
  Split until each question-sized concept has one named home, then stop.
- **Colocate tests.** One search should find behavior and its specification together.
  Rust: `#[cfg(test)] mod tests` inside the source file.
  Go: `foo_test.go` next to `foo.go`.
  TS: `foo.test.ts` next to `foo.ts`.
- **Mark dead ends.** `@deprecated` on the old path, with a pointer to the new one.

## 4. Errors are search queries too

Every error seen in a log or stack trace must grep straight back to its throw/return site
in one search.

- **Assign a static error code.** Format: `ERR_DOMAIN_REASON`, SCREAMING_SNAKE. Error
  codes are globally unique constants across the codebase; collisions are bugs.
- **Prefix the human message with the code.** The code anchors the search; the message
  provides context. Dynamic interpolation may follow the static prefix, never replace it.
- **Never construct error strings dynamically.** `fmt.Sprintf(prefix + ": %s", err)` or
  `` `${prefix}: failed` `` makes the literal unsearchable. Write the full static prefix
  even when a helper feels DRYer.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("ERR_AUTH_EXPIRED: session token for {user_id} has expired")]
    SessionExpired { user_id: UserId },
}
```

```go
const ErrCodePartitionExhausted = "ERR_PARTITION_EXHAUSTED"

var ErrPartitionExhausted = fmt.Errorf("%s: ring reached max capacity", ErrCodePartitionExhausted)
```

```typescript
export class PaymentTimeoutError extends Error {
  readonly code = "ERR_PAYMENT_TIMEOUT" as const;
  constructor(orderId: OrderId) {
    super(`ERR_PAYMENT_TIMEOUT: gateway did not respond for order ${orderId}`);
  }
}
```

## Quick checklist before committing

1. Would one search for each new exported name be enough to find its implementation?
2. Would swapping two arguments of the new function fail the build?
3. Is the one thing a caller must know but the signature can't say (units, timezone,
   ownership, ordering) written right at the definition?
4. Do all error codes exist as static constants, and do log strings contain them verbatim?
5. Does the doc comment contain the plain-words phrase a human would search for?
6. Did anything change behavior without changing its name?
7. When code moved, is it gone from where it came from?
8. Are re-exports pointing to one canonical definition (no duplicated implementations)?

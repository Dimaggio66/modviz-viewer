# Claude Code Guidelines for ifc-lite

See [AGENTS.md](./AGENTS.md) for the full agent guidelines used by all AI assistants in this project.

---

<!-- Appended from andrej-karpathy-skills — github.com/forrestchang/andrej-karpathy-skills -->

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project rules for ifc-lite

Everything above is the upstream Karpathy guideline text, kept verbatim so it
can be diffed against its source. The rules below are specific to this repo.

## 5. Scope Gate

**Show the plan before a large change, not after.**

- More than ~150 changed lines, or more than 3 files: state a 3-line plan and
  wait for confirmation before writing code.
- A new dependency, a new architectural pattern, or deleting an existing
  behaviour: raise it first, even if the diff is small.
- Splitting one request into several smaller, verifiable steps is always
  allowed and usually better than one large one.

This is the checkable form of "Simplicity First" — "think about it" is not
something either of us can verify afterwards; a line count is.

## 6. Verification In The Running App

**Typecheck and tests are the floor, not the proof.**

Finish a change to the viewer with all three:
1. `pnpm typecheck` (root, turbo)
2. the tests covering the touched module
3. a live check in the running viewer against a real model

The third one is not ceremony. In this codebase it caught defects the first two
structurally cannot see, because they are about what the IFC data actually
contains:
- the columnar property table is empty by design after a STEP parse
  (issue #577) — reads have to go through `getProperties`;
- attributes can live on the defining **type**, not the occurrence, and a type
  entity answers `getProperties` with nothing at all;
- rules that resolve their own objects carry no entity-id list, so anything
  keyed on `entityIds` silently does nothing.

Each of those typechecked cleanly and passed unit tests while being wrong.

## 7. Report What Actually Happened

- Name the numbers a check produced, not just "works".
- If a bug is found while verifying, say so plainly, including when it was
  something introduced earlier in the same session.
- If part of a request was not delivered, say which part and why — do not let
  it disappear into a summary.

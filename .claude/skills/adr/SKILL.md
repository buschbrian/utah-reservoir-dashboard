---
name: adr
description: Write an architecture decision record, or change the status of an existing one. Use whenever a decision changes behaviour, method, scope, vocabulary or a public contract.
---

# Architecture decision records

**Trigger:** a change that alters what the product claims, how a number is
measured, what a link means, what is published, or which source wins.

## The rule that outranks convenience

**An accepted record is history.** Never rewrite its body to match later work —
not the reasoning, not the numbers, not the links. Only its *status* line
changes, and only to name a successor.

## Process

1. Read the current record for the domain first. The routing index is
   [`docs/decisions/README.md`](../../../docs/decisions/README.md); start with
   the record named under your domain heading.
2. Number the new record after the highest existing one. File name:
   `ADR-0NN-a-sentence-in-lower-case.md`.
3. Write it in the shape the existing records use: context, the decision, what
   was rejected and why, the consequences, and what it supersedes.
4. Set the superseded record's status line to `Superseded by ADR-0NN`. Change
   nothing else in it.
5. Update `docs/decisions/README.md` in **both** places: the domain routing
   list and the numeric table.
6. Update `docs/architecture/` so the current description matches the new
   decision. The ADR says why; the architecture document says what is true now.

## Do not

- record a decision nobody made — an ADR is for a choice with a rejected
  alternative;
- repair a link in an accepted record;
- leave the routing index and the numeric table disagreeing.

## Done means

The new record exists, the superseded one names it, both parts of the index are
updated, the architecture document matches, and `npm run verify:fast` passes.

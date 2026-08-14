# ADR-026: Quote machine identifiers in API documentation

**Status:** Accepted

## Context

ADR-006 requires reader-facing language to use clear, expanded terms. The public JSON
contract predates that rule and contains abbreviated machine keys and provider keys. An API
reference that renames those keys would be easier to read but impossible to use: copied code
would not match the published files.

## Decision

The public API reference may quote an exact JSON key or enumerated machine value inside code
styling. Every heading, unit, explanation, control label and status message still follows
ADR-006. Machine identifiers are never used as unexplained prose.

The documentation schema is tested against the current payload keys. A new payload field must
therefore gain a plain-language definition in the same change.

## Consequences

- Consumers can copy the exact contract without guessing how a plain-language label maps to
  JSON.
- The exception is limited to literal machine identifiers in the API reference.
- The existing application and comparison-page language tests remain unchanged.

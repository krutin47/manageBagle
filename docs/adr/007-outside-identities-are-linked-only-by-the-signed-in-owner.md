# ADR-007: Outside identities are linked only by the signed-in owner

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

The first version linked a Google sign-in to an existing account when the email matched, and removed that account's password and MFA if its email was unconfirmed. A matching email, even a verified one, is not consent from the account's owner.

## Decision

An outside identity attaches to an account in exactly two ways: it creates a new account, or the signed-in owner links it from Settings after re-entering a password or authenticator code (a five-minute, single-account, single-provider ticket). A sign-in whose email matches an existing account is refused and changes nothing. The last remaining way to sign in cannot be disconnected.

## Alternatives rejected

Auto-link on verified email; auto-link plus credential removal.

## Consequences

Slightly more friction for someone who registered with a password and later wants Google: they link it once in Settings. **Existing accounts:** the migration marks them email-confirmed so nobody is locked out; this is safe because a confirmed email no longer grants linking. No account had been linked in production (there is no production yet).

## Implementation state

Implemented, with tests that play the attacker.

# Security policy

LabKit handles health information, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report privately through GitHub:
**Security → Report a vulnerability** on this repository
(private vulnerability reporting).

Include what you found, how to reproduce it, and its impact. Please **don't
include real patient data or real lab reports**; use synthetic examples
(`pnpm fixtures` generates some).

You can expect an acknowledgement within a few days. Please give reasonable
time for a fix before any public disclosure.

## Scope

In scope: the web app and signing Worker in this repository, and the
deployments at labkit.health and staging.labkit.health. Examples:

- getting the signing service to sign something it shouldn't (for example,
  non-lab or immunization records, or codes outside the dictionary)
- any way health data could be stored, logged, or sent to a third party
- bypassing Turnstile or rate limits at scale
- Content Security Policy or header weaknesses

Out of scope: denial-of-service testing, social engineering, and issues in
third-party services (Cloudflare, Apple Health) themselves.

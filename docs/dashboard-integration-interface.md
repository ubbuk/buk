# Interface for a future sign-in from the main Dashboard (DESIGN ONLY)

**Nothing in this document is implemented.** There is no SSO, no token handoff and no code in this repository that talks to the Dashboard. The Dashboard's repository was not read, searched or changed to write it; the Dashboard is treated as an unknown external system. This document fixes the rules the ERP will insist on, so the integration can be added later without weakening what exists.

Goal: the Dashboard's sidebar gets a "Хангамжийн хэлтэс" button that opens this ERP, and the ERP must stay safe when it is opened either way.

## 1. Rules that hold today and must hold forever

1. **The ERP is its own authority.** Whatever the Dashboard says, the ERP decides authentication, the session, and authorisation from its own database. A direct URL (typed, bookmarked, from another site) always meets the ERP's own checks: the middleware, the `(app)` layout's database validation, and every API route (`lib/route-access.ts`, tested for every route).
2. **A role is never taken from outside.** The ERP user's role, department and approval positions come only from the ERP database.
3. **No auto-provisioning.** A person the Dashboard knows but the ERP does not is refused; accounts are created by the ERP's own procedure (with dual control for privileged roles).
4. **Revocation applies.** Any session created through the integration is an ordinary ERP session carrying `sessionVersion`; deactivation, a password change, or "sign out everywhere" end it (`lib/session-revocation.ts`).
5. **PIN approvals and the audit trail are unchanged.** Signing in through the Dashboard does not satisfy a PIN or a password re-entry; those are asked again inside the ERP. The purchase-order approval workflow (including the executive director's approval of orders) is untouched.

## 2. Proposed handoff (when it is approved)

A back-channel **authorization-code** exchange, not a token in the URL that the browser can leak:

1. The user clicks the button in the Dashboard. The Dashboard (already authenticated) creates a one-time **code**: random, 256 bits, bound to the Dashboard user id, the ERP audience, a `nonce` and a `state`, valid **60 seconds**, single use. It redirects the browser to `https://<erp>/api/auth/handoff?code=…&state=…`.
2. The ERP checks `state` against a value stored for this browser (CSRF), then calls the Dashboard **server to server** (TLS, a client secret held in an environment variable, optionally mutual TLS) to exchange the code for a small signed assertion: `iss`, `aud` (this ERP), `sub` (a stable Dashboard user id), `email`, `iat`, `exp` (≤ 60 s), `jti`.
3. The ERP verifies the signature against a pinned key set, `aud`, `exp`, and that `jti` was never used (stored for the assertion's lifetime). It maps `sub` or the verified e-mail to **one existing, active** ERP user. Any failure is the same generic refusal, throttled like login (`lib/login-throttle.ts`).
4. On success the ERP issues its own session exactly as the login does (`authorize` in `lib/auth.ts` equivalent) and redirects to an **allow-listed** path (never a URL the Dashboard supplies: no open redirect).

Alternatives rejected: putting a long-lived token in the URL or in `localStorage`; trusting a shared cookie across domains; an `iframe` embed (the ERP will send `frame-ancestors 'none'`; it opens in its own tab or window).

## 3. Accounts that must not be reachable through the handoff alone

The Dashboard becomes an identity provider; whoever controls it can mint any identity it can name. Therefore:

- The ADMIN account, the executive director, and every account that carries authority (`lib/credential-guard.ts` `approvalCapability`) **keep their ERP password**: the handoff opens an ERP page that still asks for the ERP password (or, later, a second factor) before a privileged session is issued.
- Ordinary accounts may be signed in by the handoff alone.
- A kill switch (`DASHBOARD_HANDOFF=off`, the default) removes the endpoint.

## 4. What the ERP needs from the Dashboard team (only a contract, no code access)

A stable user id, a verified e-mail, a signing key set (public), the exchange endpoint URL, and an agreed `aud` value. Nothing about the Dashboard's own authentication has been studied or is required.

## 5. Threats considered

Replay (one-time code and `jti`), code theft in transit (60 s, back channel, single use), CSRF on the redirect (`state`), open redirect (allow-list), confused deputy / role injection (role never trusted), a compromised Dashboard (section 3, audit), clickjacking (`frame-ancestors`), enumeration (one generic error), brute force (shared throttle).

## 6. Before any of this is built

Approval of the contract by both teams; a decision on privileged accounts (section 3); the second-factor decision from `docs/security-stage-2-4.md` section 8; and a test plan that includes the direct-URL suite (`e2e/security`) with the handoff enabled and disabled.

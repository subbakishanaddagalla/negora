# NEGORA Security Specification (Phase 0)

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be created, updated, or deleted by the authenticated owner (`request.auth.uid == userId`), and read/listed only by the owner or the verified host admin (`kishanaddagalla@gmail.com` with `email_verified == true`).
2. A `GradingPreset`, `FilmRoll`, or `FilmFrame` under `/users/{userId}` requires an existing parent doc, verified email, strict key allowlist, bounded payload sizes, immutable IDs/owners/timestamps, and `!exists(/blockedUsers/{userId})`.
3. `SiteConfig` at `/siteConfig/global` is publicly readable (`get` only, no `list`, no PII), and writable strictly by `isHostAdmin()`.
4. `FeaturedPreset` at `/featuredPresets/{presetId}` is readable (`get` and `list` where `resource.data.isPublic == true`) by users, and writable strictly by `isHostAdmin()`.
5. `FeedbackReport` at `/feedback/{feedbackId}` can be created by verified signed-in users with `authorUid == request.auth.uid` and `status == 'open'`, read/listed only by the author or `isHostAdmin()`, and updated (`status`, `hostNote`, `updatedAt`) strictly by `isHostAdmin()`.
6. `BlockedMember` at `/blockedUsers/{userId}` can be checked (`get`) only by the affected user or `isHostAdmin()`, and listed/written/deleted strictly by `isHostAdmin()` (host cannot block themselves).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Private Write**: Read/write `/users/u1/rolls/roll-1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Non-Host Write to SiteConfig**: Authenticated non-host `u2` updates `/siteConfig/global` (`maintenanceMode: true`) -> `PERMISSION_DENIED`.
3. **Non-Host Publish Featured Preset**: Authenticated non-host `u2` creates `/featuredPresets/look-1` -> `PERMISSION_DENIED`.
4. **Non-Host Member/Blocked List Scrape**: Authenticated non-host `u2` lists `/users` or `/blockedUsers` -> `PERMISSION_DENIED`.
5. **Unverified Admin Email Spoof**: Authenticated with `email: "kishanaddagalla@gmail.com"` and `email_verified: false`, write `/siteConfig/global` or list `/users` -> `PERMISSION_DENIED`.
6. **Feedback Author Spoofing / Pre-Resolved**: Authenticated `u2` creates `/feedback/f1` with `authorUid: "u1"` or `status: "resolved"` -> `PERMISSION_DENIED`.
7. **Cross-Tenant Feedback Read**: Authenticated `u2` reads/lists `/feedback` belonging to `u1` -> `PERMISSION_DENIED`.
8. **Blocked User Cloud Sync Bypass**: User `u1` listed in `/blockedUsers/u1` tries to create `/users/u1/rolls/roll-1` -> `PERMISSION_DENIED`.
9. **Shadow Field Injection**: Create/update `SiteConfig` or `FilmRoll` with extra ghost field `isAdmin: true` -> `PERMISSION_DENIED`.
10. **Timestamp Forgery**: Create `FeedbackReport` or `GradingPreset` with forged `createdAt` != `request.time` -> `PERMISSION_DENIED`.
11. **Path Variable Poisoning**: Create document with 300-character invalid ID containing `/` or spaces -> `PERMISSION_DENIED`.
12. **Oversized Payload / Type Poisoning**: Write `FeedbackReport` with `message` > 1000 chars or `UserProfile.presetCount` as string `"5"` -> `PERMISSION_DENIED`.

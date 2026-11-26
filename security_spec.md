# NEGORA Security Specification (Phase 0)

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be read, created, updated, or deleted by the authenticated owner whose `request.auth.uid == userId`, with `uid` immutable and matching `request.auth.uid`.
2. A `GradingPreset` at `/users/{userId}/presets/{presetId}` requires an existing parent `/users/{userId}` document (Master Gate), verified email, strict key allowlist, and immutable `ownerId` / `createdAt`.
3. A `FilmRoll` at `/users/{userId}/rolls/{rollId}` requires an existing parent `/users/{userId}` document, verified email, strict key allowlist, bounded string lengths, and immutable `id`, `ownerId`, and `createdAt`.
4. A `FilmFrame` at `/users/{userId}/rolls/{rollId}/frames/{frameId}` requires an existing parent `FilmRoll` owned by `request.auth.uid` (Master Gate), verified email, strict key allowlist, bounded `syncImageDataUrl` (< 750KB), and immutable `id`, `ownerId`, `rollId`, and `createdAt`.
5. All `list` queries on `presets`, `rolls`, and `frames` enforce `resource.data.ownerId == request.auth.uid` at rule level without `get()`/`exists()` inside `allow list`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: Read or write `/users/u1/rolls/r1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Read**: Authenticated as `u2`, `get` `/users/u1/rolls/r1` -> `PERMISSION_DENIED`.
3. **Cross-Tenant List**: Authenticated as `u2`, `list` `/users/u1/presets` -> `PERMISSION_DENIED`.
4. **Owner Spoofing on Create**: Authenticated as `u2`, create `/users/u2/rolls/r1` with `ownerId: "u1"` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: Create/update `FilmRoll` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
6. **Unverified Email Write**: Authenticated with `email_verified: false`, write `/users/u1/presets/p1` -> `PERMISSION_DENIED`.
7. **Timestamp Forgery**: Create `GradingPreset` with client-supplied `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: Update `FilmRoll` changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
9. **Path Variable Poisoning**: Create document with 300-character invalid ID containing `/` or spaces -> `PERMISSION_DENIED`.
10. **Orphaned Subcollection Write**: Create `FilmFrame` under non-existent `/users/u1/rolls/missing` -> `PERMISSION_DENIED`.
11. **Oversized Payload (Denial of Wallet)**: Write `FilmFrame` with `syncImageDataUrl` > 750,000 chars or `notes` > 600 chars -> `PERMISSION_DENIED`.
12. **Type Poisoning**: Update `FilmRoll.frameCount` with a string `"10"` instead of integer -> `PERMISSION_DENIED`.

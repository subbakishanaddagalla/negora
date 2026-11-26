/**
 * Phase 0 Adversarial Security Verification Spec for NEGORA Firestore Rules.
 * Covers all 12 "Dirty Dozen" payloads from security_spec.md.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authUid: string | null;
  emailVerified?: boolean;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read',
    path: '/users/u1/rolls/roll-1',
    operation: 'get',
    authUid: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-tenant roll read',
    path: '/users/u1/rolls/roll-1',
    operation: 'get',
    authUid: 'u2',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-tenant preset list',
    path: '/users/u1/presets',
    operation: 'list',
    authUid: 'u2',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Owner spoofing on create',
    path: '/users/u2/rolls/roll-1',
    operation: 'create',
    authUid: 'u2',
    emailVerified: true,
    payload: { id: 'roll-1', ownerId: 'u1', rollTitle: 'Spoofed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow field injection (isAdmin)',
    path: '/users/u1/rolls/roll-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'roll-1', ownerId: 'u1', rollTitle: 'Test', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified email write',
    path: '/users/u1/presets/preset-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: false,
    payload: { id: 'preset-1', ownerId: 'u1', name: 'Portra Look' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client-forged createdAt timestamp',
    path: '/users/u1/presets/preset-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'preset-1', ownerId: 'u1', name: 'Portra Look', createdAt: '2020-01-01' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable ownerId mutation on update',
    path: '/users/u1/rolls/roll-1',
    operation: 'update',
    authUid: 'u1',
    emailVerified: true,
    payload: { ownerId: 'u2' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Path variable poisoning (oversized invalid ID)',
    path: `/users/u1/rolls/${'x'.repeat(200)}`,
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'x'.repeat(200), ownerId: 'u1', rollTitle: 'Bad ID' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned frame write without parent roll',
    path: '/users/u1/rolls/nonexistent-roll/frames/frame-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'frame-1', ownerId: 'u1', rollId: 'nonexistent-roll', name: 'Orphan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Oversized payload poisoning',
    path: '/users/u1/rolls/roll-1/frames/frame-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'frame-1', ownerId: 'u1', rollId: 'roll-1', notes: 'a'.repeat(2000) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Type poisoning on frameCount',
    path: '/users/u1/rolls/roll-1',
    operation: 'update',
    authUid: 'u1',
    emailVerified: true,
    payload: { frameCount: '10' },
    expected: 'PERMISSION_DENIED',
  },
];

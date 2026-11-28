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
  email?: string;
  emailVerified?: boolean;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated roll read',
    path: '/users/u1/rolls/roll-1',
    operation: 'get',
    authUid: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Non-host SiteConfig write',
    path: '/siteConfig/global',
    operation: 'update',
    authUid: 'u2',
    email: 'other@example.com',
    emailVerified: true,
    payload: { maintenanceMode: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Non-host FeaturedPreset publish',
    path: '/featuredPresets/look-1',
    operation: 'create',
    authUid: 'u2',
    email: 'other@example.com',
    emailVerified: true,
    payload: { id: 'look-1', ownerId: 'u2', name: 'Fake Look', isPublic: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Non-host /users and /blockedUsers list scrape',
    path: '/users',
    operation: 'list',
    authUid: 'u2',
    email: 'other@example.com',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified admin email spoof on /users list',
    path: '/users',
    operation: 'list',
    authUid: 'spoof-uid',
    email: 'kishanaddagalla@gmail.com',
    emailVerified: false,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Feedback authorUid spoofing on create',
    path: '/feedback/fb-1',
    operation: 'create',
    authUid: 'u2',
    emailVerified: true,
    payload: { id: 'fb-1', authorUid: 'u1', status: 'open', message: 'Spoofed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Cross-tenant feedback read',
    path: '/feedback/fb-owned-by-u1',
    operation: 'get',
    authUid: 'u2',
    emailVerified: true,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Blocked user attempting cloud roll sync',
    path: '/users/blocked-u1/rolls/roll-1',
    operation: 'create',
    authUid: 'blocked-u1',
    emailVerified: true,
    payload: { id: 'roll-1', ownerId: 'blocked-u1', rollTitle: 'Blocked Roll' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Shadow field injection (isAdmin)',
    path: '/users/u1/rolls/roll-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'roll-1', ownerId: 'u1', rollTitle: 'Test', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Client-forged createdAt timestamp',
    path: '/users/u1/presets/preset-1',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'preset-1', ownerId: 'u1', name: 'Portra Look', createdAt: '2020-01-01' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Path variable poisoning (oversized invalid ID)',
    path: `/users/u1/rolls/${'x'.repeat(200)}`,
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'x'.repeat(200), ownerId: 'u1', rollTitle: 'Bad ID' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Oversized feedback message & type poisoning',
    path: '/feedback/fb-2',
    operation: 'create',
    authUid: 'u1',
    emailVerified: true,
    payload: { id: 'fb-2', authorUid: 'u1', message: 'a'.repeat(2000), status: 'open' },
    expected: 'PERMISSION_DENIED',
  },
];

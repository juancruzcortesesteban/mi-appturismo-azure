import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessView, canManagePlace, calculateColombianDistance } from './rbac.ts';

test('view access is determined by effective permissions, including custom roles', () => {
  assert.equal(canAccessView('Turista', 'admin').allowed, false);
  assert.equal(canAccessView('CustomRole', 'admin', null, ['access_admin']).allowed, true);
  assert.equal(canAccessView('CustomRole', 'merchant', null, ['access_merchant']).allowed, true);
  assert.equal(canAccessView('CustomRole', 'code', null, ['access_rbac']).allowed, true);
  assert.equal(canAccessView('CustomRole', 'places').allowed, true);
  assert.equal(canAccessView('CustomRole', 'index').allowed, true);
});

test('place management uses operation permissions and ownership', () => {
  const place = { id: 101, name: 'Parque El Cocuy', merchantId: 10, category: 'Aventura' };
  const customOwner = {
    id: 10,
    email: 'merchant@example.test',
    fullName: 'Custom Merchant',
    role: 'CustomMerchant',
    permissions: ['write_operations'],
  };
  const customVisitor = { ...customOwner, id: 20 };
  const admin = {
    id: 1,
    email: 'admin@example.test',
    fullName: 'Admin',
    role: 'CustomAdmin',
    permissions: ['access_admin'],
  };
  const readOnly = {
    id: 3,
    email: 'reader@example.test',
    fullName: 'Reader',
    role: 'CustomReader',
    permissions: ['read_only'],
  };

  assert.equal(canManagePlace(customOwner, place).canEdit, true);
  assert.equal(canManagePlace(customOwner, place).canDelete, true);
  assert.equal(canManagePlace(customVisitor, place).canEdit, false);
  assert.equal(canManagePlace(admin, place).canDelete, true);
  assert.equal(canManagePlace(readOnly, place).canEdit, false);
});

test('routing distance uses realistic estimates for Colombia topography', () => {
  const result = calculateColombianDistance(4.5981, -74.0758, 6.2328, -75.1565, 'vehicle');
  assert.ok(result.distanceKm > 200, 'Distance should be greater than 200km');
  assert.ok(result.durationHours > 3, 'Duration in vehicle should be realistic');
});

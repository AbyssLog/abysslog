const assert = require('node:assert/strict');
const test = require('node:test');

const { classifyShipByGroup } = require('../src/shared/ship-groups');

test('classifies every Abyss-compatible ship group', () => {
  const expectedGroups = new Map([
    ['Frigate', [25, 324, 830, 831, 834, 893, 1022, 1283, 1527]],
    ['Destroyer', [420, 541, 1305, 1534]],
    ['Cruiser', [26, 358, 832, 833, 894, 906, 1972]],
  ]);

  for (const [shipClass, groupIds] of expectedGroups) {
    for (const groupId of groupIds) {
      assert.equal(classifyShipByGroup(groupId), shipClass, `group ${groupId}`);
    }
  }
});

test('ignores groups outside the Abyss-compatible allowlists', () => {
  assert.equal(classifyShipByGroup(1), 'Unknown');
  assert.equal(classifyShipByGroup(null), 'Unknown');
  assert.equal(classifyShipByGroup('26'), 'Unknown');
});

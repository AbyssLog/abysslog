const assert = require('node:assert/strict');
const test = require('node:test');

const { createFitIdentity } = require('../src/shared/fit-identity');
const { buildFitItem, buildImplant } = require('./support/builders');

const hull = buildFitItem({
  type_id: 17_918,
  type_name: 'Gila',
  slot: 'hull',
});
const launchersSplitAcrossSlots = [
  buildFitItem({ type_id: 33_201, qty: 2, slot: 'HiSlot0' }),
  buildFitItem({ type_id: 33_201, qty: 2, slot: 'HiSlot4' }),
];
const launchersGrouped = [
  buildFitItem({ type_id: 33_201, qty: 4, slot: 'HiSlot1' }),
];

test('fit identity ignores slot placement but includes drones and implants', () => {
  const crystal = [buildImplant({ type_id: 22_101, type_name: 'Mid-grade Crystal Alpha' })];
  const sameFit = createFitIdentity([hull, ...launchersSplitAcrossSlots], crystal);
  const regroupedFit = createFitIdentity([hull, ...launchersGrouped], crystal);
  const differentImplant = createFitIdentity(
    [hull, ...launchersGrouped],
    [buildImplant({ type_id: 22_201, type_name: 'Mid-grade Asklepian Alpha' })]
  );
  const differentDrone = createFitIdentity(
    [hull, ...launchersGrouped, buildFitItem({
      type_id: 21_638,
      type_name: 'Vespa II',
      qty: 5,
      slot: 'DroneBay',
    })],
    crystal
  );

  assert.equal(regroupedFit.signature, sameFit.signature);
  assert.notEqual(differentImplant.signature, sameFit.signature);
  assert.notEqual(differentDrone.signature, sameFit.signature);
});

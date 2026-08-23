function mapMatchingItem(item) {
  return { item_name: item.item_name, type: item.type };
}

function mapRunItem(item) {
  return {
    item_name: item.item_name,
    qty: item.qty,
    type: item.type,
    unit_price_buy: item.unit_price_buy,
    unit_price_sell: item.unit_price_sell,
  };
}

function mapFittingItem(item) {
  return {
    type_id: item.type_id,
    type_name: item.type_name,
    qty: item.qty,
    slot: item.slot,
    unit_price_sell: item.unit_price_sell,
  };
}

function mapImplant(item) {
  return {
    type_id: item.type_id,
    type_name: item.type_name,
    slot: item.slot,
    unit_price_sell: item.unit_price_sell,
  };
}

function mapRunSummary(run) {
  if (!run) return null;
  return {
    id: run.id,
    character_id: run.character_id,
    character_name: run.character_name,
    fit_identity_id: run.fit_identity_id,
    fit_key: run.fit_key,
    fit_display_name: run.fit_display_name,
    started_at: run.started_at,
    duration: run.duration,
    tier: run.tier,
    weather: run.weather,
    outcome: run.outcome,
    hull_name: run.hull_name,
    ship_class: run.ship_class,
    system_id: run.system_id,
    system_name: run.system_name,
    loot_value: run.loot_value,
    consumed_cost: run.consumed_cost,
    net_isk: run.net_isk,
    total_loss: run.total_loss,
    appraised_at: run.appraised_at,
    notes: run.notes,
    tags: (run.tags || []).map(String),
    matching_items: (run.matching_items || []).map(mapMatchingItem),
  };
}

function mapRunDetail(run) {
  if (!run) return null;
  return {
    ...mapRunSummary(run),
    cargo_before: run.cargo_before,
    cargo_after: run.cargo_after,
    drone_before: run.drone_before,
    drone_after: run.drone_after,
    items: (run.items || []).map(mapRunItem),
    fitting: (run.fitting || []).map(mapFittingItem),
    implants: (run.implants || []).map(mapImplant),
    killmail_ids: (run.killmail_ids || []).map(Number),
  };
}

function mapInventoryBaseline(run) {
  if (!run) return null;
  return {
    id: run.id,
    character_id: run.character_id,
    started_at: run.started_at,
    outcome: run.outcome,
    cargo_after: run.cargo_after,
    drone_before: run.drone_before,
    drone_after: run.drone_after,
  };
}

function mapAppraisalHistoryItem(appraisal) {
  return {
    id: appraisal.id,
    kind: appraisal.kind,
    source: appraisal.source,
    provider: appraisal.provider,
    appraised_at: appraisal.appraised_at,
    resolution_status: appraisal.resolution_status,
    loot_value: appraisal.loot_value,
    consumed_cost: appraisal.consumed_cost,
    net_isk: appraisal.net_isk,
    total_loss: appraisal.total_loss,
    is_current: appraisal.is_current === 1,
    line_count: appraisal.line_count,
  };
}

module.exports = {
  mapAppraisalHistoryItem,
  mapInventoryBaseline,
  mapRunDetail,
  mapRunSummary,
};

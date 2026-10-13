/**
 * Standard Unit of Measurement & Conversion Utility
 * Supports weight, volume, and count conversions
 */

const UNIT_MAP = {
  // Weight / Mass (Base: Grams)
  mg: { category: 'weight', factor: 0.001, label: 'mg' },
  milligram: { category: 'weight', factor: 0.001, label: 'mg' },
  milligrams: { category: 'weight', factor: 0.001, label: 'mg' },
  g: { category: 'weight', factor: 1, label: 'g' },
  gram: { category: 'weight', factor: 1, label: 'g' },
  grams: { category: 'weight', factor: 1, label: 'g' },
  gm: { category: 'weight', factor: 1, label: 'g' },
  kg: { category: 'weight', factor: 1000, label: 'kg' },
  kgs: { category: 'weight', factor: 1000, label: 'kg' },
  kilogram: { category: 'weight', factor: 1000, label: 'kg' },
  kilograms: { category: 'weight', factor: 1000, label: 'kg' },
  quintal: { category: 'weight', factor: 100000, label: 'quintal' },
  ton: { category: 'weight', factor: 1000000, label: 'ton' },
  tonne: { category: 'weight', factor: 1000000, label: 'ton' },

  // Volume (Base: Milliliters)
  ml: { category: 'volume', factor: 1, label: 'ml' },
  milliliter: { category: 'volume', factor: 1, label: 'ml' },
  milliliters: { category: 'volume', factor: 1, label: 'ml' },
  millilitre: { category: 'volume', factor: 1, label: 'ml' },
  millilitres: { category: 'volume', factor: 1, label: 'ml' },
  l: { category: 'volume', factor: 1000, label: 'l' },
  ltr: { category: 'volume', factor: 1000, label: 'l' },
  liter: { category: 'volume', factor: 1000, label: 'l' },
  liters: { category: 'volume', factor: 1000, label: 'l' },
  litre: { category: 'volume', factor: 1000, label: 'l' },
  litres: { category: 'volume', factor: 1000, label: 'l' },

  // Count / Discrete (Base: Pieces)
  pcs: { category: 'count', factor: 1, label: 'pcs' },
  pc: { category: 'count', factor: 1, label: 'pcs' },
  piece: { category: 'count', factor: 1, label: 'pcs' },
  pieces: { category: 'count', factor: 1, label: 'pcs' },
  unit: { category: 'count', factor: 1, label: 'pcs' },
  units: { category: 'count', factor: 1, label: 'pcs' },
  nos: { category: 'count', factor: 1, label: 'pcs' },
  dozen: { category: 'count', factor: 12, label: 'pcs' },
  dozens: { category: 'count', factor: 12, label: 'pcs' },
  box: { category: 'count', factor: 1, label: 'box' },
  boxes: { category: 'count', factor: 1, label: 'box' },
  pkt: { category: 'count', factor: 1, label: 'packet' },
  packet: { category: 'count', factor: 1, label: 'packet' },
  packets: { category: 'count', factor: 1, label: 'packet' },
  bundle: { category: 'count', factor: 1, label: 'bundle' },
  set: { category: 'count', factor: 1, label: 'set' },
  roll: { category: 'count', factor: 1, label: 'roll' }
};

function normalizeUnit(unit) {
  if (!unit) return 'pcs';
  const clean = String(unit).trim().toLowerCase();
  return clean;
}

function areUnitsCompatible(unitA, unitB) {
  const normA = normalizeUnit(unitA);
  const normB = normalizeUnit(unitB);
  if (normA === normB) return true;
  const defA = UNIT_MAP[normA];
  const defB = UNIT_MAP[normB];
  if (!defA || !defB) return false;
  return defA.category === defB.category;
}

/**
 * Convert quantity from one unit to another
 * @param {number} quantity - Quantity to convert
 * @param {string} fromUnit - Original unit
 * @param {string} toUnit - Target unit
 * @returns {number} Converted quantity
 */
function convertUnit(quantity, fromUnit, toUnit) {
  const num = Number(quantity) || 0;
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) return num;

  const defFrom = UNIT_MAP[normFrom];
  const defTo = UNIT_MAP[normTo];

  if (!defFrom || !defTo || defFrom.category !== defTo.category) {
    // If incompatible or unknown, return original quantity
    return num;
  }

  // Convert to base unit then to target unit
  const baseQty = num * defFrom.factor;
  const targetQty = baseQty / defTo.factor;
  return targetQty;
}

const STANDARD_UNITS = [
  { code: 'pcs', label: 'Piece (pcs)', category: 'count' },
  { code: 'box', label: 'Box', category: 'count' },
  { code: 'packet', label: 'Packet', category: 'count' },
  { code: 'dozen', label: 'Dozen (12 pcs)', category: 'count' },
  { code: 'kg', label: 'Kilogram (kg)', category: 'weight' },
  { code: 'g', label: 'Gram (g)', category: 'weight' },
  { code: 'mg', label: 'Milligram (mg)', category: 'weight' },
  { code: 'l', label: 'Litre (L)', category: 'volume' },
  { code: 'ml', label: 'Millilitre (ml)', category: 'volume' },
  { code: 'meter', label: 'Meter (m)', category: 'length' },
  { code: 'sqm', label: 'Square Meter (sqm)', category: 'area' }
];

module.exports = {
  UNIT_MAP,
  normalizeUnit,
  areUnitsCompatible,
  convertUnit,
  STANDARD_UNITS
};

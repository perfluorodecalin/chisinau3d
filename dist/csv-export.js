const HEADERS = ['osm_type','osm_id','name','building','height_m','height_method','mapped_floors','footprint_m2','height_explanation'];
const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+@＝＋＠－-]/;

function textCell(value) {
  let text = String(value ?? '');
  // Spreadsheet applications may evaluate formula-like text on import. Prefix
  // the original value with an apostrophe while keeping normal text unchanged.
  if (FORMULA_PREFIX.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function numberCell(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function buildingCsv(records) {
  const rows = [HEADERS.map(textCell).join(',')];
  const unique = new Set();
  for (const r of records) {
    const id = r.type + '/' + r.id;
    if (unique.has(id)) continue;
    unique.add(id);
    rows.push([
      textCell(r.type), numberCell(Number(r.id)), textCell(r.tags.name || ''),
      textCell(r.tags.building), numberCell(r.height), textCell(r.source),
      numberCell(r.floors), numberCell(Math.round(r.area)), textCell(r.reason),
    ].join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

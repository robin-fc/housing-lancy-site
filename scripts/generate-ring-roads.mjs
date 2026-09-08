import { readFileSync, writeFileSync } from 'node:fs';

// Sample OSM road intersections by bearing to form simplified, non-survey boundaries.
const source = JSON.parse(readFileSync(new URL('../.codex-tmp/ring-roads-osm.json', import.meta.url)));
const center = [121.49, 31.235];
const definitions = [
  { id: 'outer', name: '外环', color: '#2879c7', roads: ['外环高速', '外环隧道'] },
  { id: 'middle', name: '中环', color: '#d58a16', roads: ['中环路', '军工路隧道', '上中路隧道'] },
  { id: 'inner', name: '内环', color: '#a34abb', roads: ['内环高架路', '南浦大桥', '杨浦大桥'] },
];

function toGcj02(lng, lat) {
  const x = lng - 105;
  const y = lat - 35;
  const pi = Math.PI;
  const wave = (value, period) => Math.sin(value * pi / period);
  const common = (20 * wave(6 * x, 1) + 20 * wave(2 * x, 1)) * 2 / 3;
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  dLat += common + (20 * wave(y, 1) + 40 * wave(y, 3)) * 2 / 3;
  dLat += (160 * wave(y, 12) + 320 * wave(y, 30)) * 2 / 3;
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dLng += common + (20 * wave(x, 1) + 40 * wave(x, 3)) * 2 / 3;
  dLng += (150 * wave(x, 12) + 300 * wave(x, 30)) * 2 / 3;
  const rad = lat * pi / 180;
  const magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2;
  const root = Math.sqrt(magic);
  dLat = dLat * 180 / ((6378245 * (1 - 0.006693421622965943) / (magic * root)) * pi);
  dLng = dLng * 180 / (6378245 / root * Math.cos(rad) * pi);
  return [Number((lat + dLat).toFixed(6)), Number((lng + dLng).toFixed(6))];
}

const rings = definitions.map(({ roads, ...meta }) => {
  const segments = source.elements
    .filter((way) => roads.includes(way.tags.name) && ['trunk', 'motorway'].includes(way.tags.highway))
    .flatMap((way) => way.geometry.slice(1).map((point, index) => [way.geometry[index], point]));
  const radii = Array.from({ length: 360 }, (_, angle) => {
    const dx = Math.cos(angle * Math.PI / 180);
    const dy = Math.sin(angle * Math.PI / 180);
    const hits = [];
    for (const [a, b] of segments) {
      const ax = a.lon - center[0];
      const ay = a.lat - center[1];
      const vx = b.lon - a.lon;
      const vy = b.lat - a.lat;
      const determinant = dx * vy - dy * vx;
      if (Math.abs(determinant) < 1e-12) continue;
      const radius = (ax * vy - ay * vx) / determinant;
      const along = (ax * dy - ay * dx) / determinant;
      if (radius > 0 && along >= 0 && along <= 1) hits.push(radius);
    }
    hits.sort((a, b) => a - b);
    return hits.length ? hits[Math.floor(hits.length / 2)] : null;
  });
  if (radii.filter((radius) => radius !== null).length < 330) throw new Error(`${meta.name}: incomplete road coverage`);
  const positions = radii.map((radius, angle) => {
    // Interpolate bridge/tunnel naming gaps between adjacent road samples.
    if (radius === null) {
      let before = 1;
      let after = 1;
      while (radii[(angle - before + 360) % 360] === null) before++;
      while (radii[(angle + after) % 360] === null) after++;
      radius = (radii[(angle - before + 360) % 360] * after + radii[(angle + after) % 360] * before) / (before + after);
    }
    const radians = angle * Math.PI / 180;
    return toGcj02(center[0] + radius * Math.cos(radians), center[1] + radius * Math.sin(radians));
  });
  positions.push([...positions[0]]);
  return { ...meta, positions };
});
writeFileSync(new URL('../src/data/rings.json', import.meta.url), JSON.stringify({
  source: 'OpenStreetMap contributors, ODbL-1.0; https://www.openstreetmap.org/copyright',
  fetchedAt: source.osm3s.timestamp_osm_base,
  coordinateSystem: 'GCJ-02',
  accuracy: 'Simplified road envelopes; interpolated gaps; not legal or survey boundaries.',
  rings,
}, null, 2) + '\n');
console.log(rings.map(({ name, positions }) => `${name}: ${positions.length} points`).join('\n'));

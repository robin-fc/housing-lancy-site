import L from 'leaflet';
import { rings } from './data/rings.json';

const outerRing = rings.find(({ id }) => id === 'outer').positions;
const outerBounds = L.latLngBounds(outerRing);

// Use Leaflet's polygon clipper in projected pixels for both filtering and masking.
export const OuterRingTileLayer = L.TileLayer.extend({
  options: {
    bounds: outerBounds,
    noWrap: true,
    keepBuffer: 0,
    updateWhenIdle: true,
    updateWhenZooming: false,
    minZoom: 10,
    maxZoom: 18,
    maxNativeZoom: 18,
  },

  _clipTile(coords) {
    if (this._ringZoom !== coords.z) {
      this._ringPoints = outerRing.map((position) => this._map.project(position, coords.z));
      this._ringZoom = coords.z;
    }
    const origin = coords.scaleBy(this.getTileSize());
    return L.PolyUtil.clipPolygon(this._ringPoints, L.bounds(origin, origin.add(this.getTileSize())));
  },

  _isValidTile(coords) {
    return L.TileLayer.prototype._isValidTile.call(this, coords) && this._clipTile(coords).length >= 3;
  },

  createTile(coords, done) {
    const tile = L.TileLayer.prototype.createTile.call(this, coords, done);
    const origin = coords.scaleBy(this.getTileSize());
    const points = this._clipTile(coords).map((point) => `${point.x - origin.x}px ${point.y - origin.y}px`);
    tile.style.clipPath = `polygon(${points.join(',')})`;
    return tile;
  },
});

export function createBasemap() {
  return new OuterRingTileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
    subdomains: '1234',
    attribution: '&copy; 高德地图',
  });
}

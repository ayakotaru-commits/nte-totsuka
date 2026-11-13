// 現在地のストリートビューを Google マップ (公式 URL) で別タブに開く。API キー不要。
// データは取得・保存しない (表示を見比べるだけ)。
export function openStreetView(city, x, z, yaw) {
  const lat0 = city.origin.lat, lon0 = city.origin.lon;
  const M_LAT = 110574.0, M_LON = 111320.0 * Math.cos(lat0 * Math.PI / 180);
  const lat = lat0 - z / M_LAT, lon = lon0 + x / M_LON;
  // カメラの向き: 前方 = (-sin yaw, -cos yaw) (x=東, z=南) → 方位角 (北=0, 時計回り)
  let heading = Math.atan2(-Math.sin(yaw), Math.cos(yaw)) * 180 / Math.PI;
  heading = (heading + 360) % 360;
  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${heading.toFixed(0)}&pitch=0&fov=90`;
  window.open(url, '_blank', 'noopener');
}

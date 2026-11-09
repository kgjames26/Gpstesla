const CELL = 0.05;
const CACHE_SECONDS = 900;
const UPSTREAMS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

function reply(res, status, payload, cacheControl = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return reply(res, 400, { error: "invalid_coordinates" });
  }
  const cellLat = Math.floor(lat / CELL) * CELL + CELL / 2;
  const cellLon = Math.floor(lon / CELL) * CELL + CELL / 2;
  const south = (cellLat - CELL / 2).toFixed(3), west = (cellLon - CELL / 2).toFixed(3);
  const north = (cellLat + CELL / 2).toFixed(3), east = (cellLon + CELL / 2).toFixed(3);
  const pointLat = lat.toFixed(3), pointLon = lon.toFixed(3);
  const query = '[out:json][timeout:10];is_in(' + pointLat + ',' + pointLon + ')->.areas;area.areas["admin_level"="2"]->.country;.country out tags;(node["highway"="speed_camera"](' + south + ',' + west + ',' + north + ',' + east + ');node["man_made"="speed_camera"](' + south + ',' + west + ',' + north + ',' + east + ');)->.cameras;way(around.cameras:40)["highway"]["maxspeed"]->.roads;(.cameras;.roads;);out body geom;';

  const controllers = UPSTREAMS.map(() => new AbortController());
  const attempts = UPSTREAMS.map(async (endpoint, index) => {
    const controller = controllers[index];
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Tesla GPS PWA/2.2 (OpenStreetMap radar display)" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!upstream.ok) throw new Error("overpass_http_" + upstream.status);
      return await upstream.json();
    } finally {
      clearTimeout(timer);
    }
  });

  let payload;
  try {
    payload = await Promise.any(attempts);
  } catch (error) {
    for (const controller of controllers) controller.abort();
    const errors = error && Array.isArray(error.errors) ? error.errors : [];
    const timedOut = errors.some(item => item && item.name === "AbortError");
    return reply(res, 503, { error: timedOut ? "overpass_timeout" : "overpass_unavailable" });
  }
  for (const controller of controllers) controller.abort();
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const countryArea = elements.find(item => item.type === "area" && item.tags && item.tags.admin_level === "2");
  const countryCode = countryArea && countryArea.tags
    ? String(countryArea.tags["ISO3166-1:alpha2"] || countryArea.tags["ISO3166-1"] || "").toUpperCase()
    : "";
  const radars = elements.filter(item => item.type === "node" && item.tags &&
    (item.tags.highway === "speed_camera" || item.tags.man_made === "speed_camera"))
    .map(item => ({ id: "node/" + item.id, lat: item.lat, lon: item.lon, maxspeed: item.tags.maxspeed ? String(item.tags.maxspeed) : null }));
  const roads = elements.filter(item => item.type === "way" && item.tags && item.tags.highway && item.tags.maxspeed && Array.isArray(item.geometry))
    .map(item => ({ maxspeed: String(item.tags.maxspeed), geometry: item.geometry.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)).map(point => [point.lon, point.lat]) }))
    .filter(item => item.geometry.length > 1);
  return reply(res, 200, {
    countryCode,
    radars,
    roads,
    updatedAt: new Date().toISOString(),
    osmDataTimestamp: payload.osm3s && payload.osm3s.timestamp_osm_base || null
  }, "public, s-maxage=" + CACHE_SECONDS + ", stale-while-revalidate=1800");
};
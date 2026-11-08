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
  const south = (cellLat - CELL / 2).toFixed(3);
  const west = (cellLon - CELL / 2).toFixed(3);
  const north = (cellLat + CELL / 2).toFixed(3);
  const east = (cellLon + CELL / 2).toFixed(3);
  const query = '[out:json][timeout:10];(node["highway"="speed_camera"](' + south + "," + west + "," + north + "," + east + ');node["man_made"="speed_camera"](' + south + "," + west + "," + north + "," + east + '););out body;';

  let lastError = "overpass_unavailable";
  for (const endpoint of UPSTREAMS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Tesla GPS PWA/2.1 (OpenStreetMap speed camera display)"
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!upstream.ok) {
        lastError = "overpass_http_" + upstream.status;
        continue;
      }
      const payload = await upstream.json();
      const radars = (Array.isArray(payload.elements) ? payload.elements : [])
        .map(item => {
          const point = item.type === "node" ? item : item.center;
          if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
          return {
            id: item.type + "/" + item.id,
            lat: point.lat,
            lon: point.lon,
            maxspeed: item.tags && item.tags.maxspeed ? String(item.tags.maxspeed) : null
          };
        })
        .filter(Boolean);
      return reply(res, 200, {
        radars,
        updatedAt: new Date().toISOString(),
        osmDataTimestamp: payload.osm3s && payload.osm3s.timestamp_osm_base || null
      }, "public, s-maxage=" + CACHE_SECONDS + ", stale-while-revalidate=1800");
    } catch (error) {
      lastError = error && error.name === "AbortError" ? "overpass_timeout" : "overpass_unavailable";
    } finally {
      clearTimeout(timer);
    }
  }
  return reply(res, 503, { error: lastError });
};
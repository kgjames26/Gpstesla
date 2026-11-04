const CELL = 0.2;
const MAX_DURATION_MS = 12000;

function send(res, status, body, cacheControl) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl || "no-store");
  res.status(status).send(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return send(res, 400, { error: "invalid_coordinates" });
  }

  const cellLat = Math.floor(lat / CELL) * CELL + CELL / 2;
  const cellLon = Math.floor(lon / CELL) * CELL + CELL / 2;
  const south = (cellLat - CELL / 2).toFixed(5);
  const west = (cellLon - CELL / 2).toFixed(5);
  const north = (cellLat + CELL / 2).toFixed(5);
  const east = (cellLon + CELL / 2).toFixed(5);
  const cameras = req.query.cameras === "1";
  const cameraStatements = cameras
    ? 'nwr["highway"="speed_camera"](' + south + "," + west + "," + north + "," + east + ');nwr["enforcement"="traffic_signals"](' + south + "," + west + "," + north + "," + east + ');'
    : "";
  const query = '[out:json][timeout:8];(' + cameraStatements +
    'nwr["hazard"](' + south + "," + west + "," + north + "," + east + ');' +
    'way["highway"="construction"](' + south + "," + west + "," + north + "," + east + ');' +
    'nwr["amenity"="charging_station"](' + south + "," + west + "," + north + "," + east + ');' +
    ');->.alerts;way(around.alerts:60)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)$"];out geom tags;.alerts out center tags;';

  const servers = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  let lastError = "overpass_unavailable";
  for (const endpoint of servers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_DURATION_MS / servers.length);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "VECTOR Navigation PWA" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!response.ok) {
        lastError = "overpass_http_" + response.status;
        continue;
      }
      const payload = await response.json();
      const elements = Array.isArray(payload.elements) ? payload.elements : [];
      return send(res, 200, {
        version: 1,
        cell: [cellLat, cellLon],
        refreshedAt: new Date().toISOString(),
        elements
      }, "public, s-maxage=21600, stale-while-revalidate=86400");
    } catch (error) {
      lastError = error && error.name === "AbortError" ? "overpass_timeout" : "overpass_unavailable";
    } finally {
      clearTimeout(timer);
    }
  }
  return send(res, 503, { error: lastError }, "no-store");
};
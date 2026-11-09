function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(payload));
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const startLat = validCoordinate(body.start?.latitude, -90, 90);
  const startLon = validCoordinate(body.start?.longitude, -180, 180);
  const endLat = validCoordinate(body.destination?.latitude, -90, 90);
  const endLon = validCoordinate(body.destination?.longitude, -180, 180);

  if ([startLat, startLon, endLat, endLon].some(value => value === null)) {
    return reply(res, 400, { error: "invalid_route_coordinates" });
  }

  const request = {
    locations: [
      { lat: startLat, lon: startLon, type: "break" },
      { lat: endLat, lon: endLon, type: "break" }
    ],
    costing: "auto",
    costing_options: {
      auto: {
        ignore_restrictions: false,
        ignore_oneways: false,
        ignore_access: false
      }
    },
    language: "fr-FR",
    units: "kilometers",
    format: "osrm",
    shape_format: "geojson",
    alternates: 2,
    roundabout_exits: true,
    turn_lanes: true,
    voice_instructions: true
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);

  try {
    const upstream = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Tesla GPS PWA/2.3 (Valhalla route proxy)"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return reply(res, 502, { error: "valhalla_route_unavailable", upstreamStatus: upstream.status });
    }
    if (!payload || payload.code !== "Ok" || !Array.isArray(payload.routes) || !payload.routes.length) {
      return reply(res, 502, { error: "valhalla_route_unavailable" });
    }
    return reply(res, 200, payload);
  } catch (error) {
    const code = error && error.name === "AbortError" ? "valhalla_route_timeout" : "valhalla_route_unavailable";
    return reply(res, 503, { error: code });
  } finally {
    clearTimeout(timer);
  }
};

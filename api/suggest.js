function reply(res, status, payload, cacheControl = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  const q = String(req.query.q || "").trim();
  const countrycode = String(req.query.countrycode || "").trim().toLowerCase();
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (q.length < 3 || q.length > 180 || !/^[a-z]{2}$/.test(countrycode)) {
    return reply(res, 400, { error: "invalid_suggestion_query" });
  }

  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({
    q,
    limit: "7",
    lang: "fr",
    countrycode,
    ...(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat: String(lat), lon: String(lon), zoom: "15", location_bias_scale: "0.25" }
      : {})
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/geo+json, application/json",
        "User-Agent": "Tesla GPS PWA/2.2 (OpenStreetMap address autocomplete)"
      },
      signal: controller.signal
    });
    if (!upstream.ok) return reply(res, 502, { error: "suggestions_unavailable" });
    const payload = await upstream.json();
    const features = Array.isArray(payload.features) ? payload.features : [];
    return reply(res, 200, { features }, "public, s-maxage=15, stale-while-revalidate=45");
  } catch (error) {
    const code = error && error.name === "AbortError" ? "suggestions_timeout" : "suggestions_unavailable";
    return reply(res, 503, { error: code });
  } finally {
    clearTimeout(timer);
  }
};

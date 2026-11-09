function reply(res, status, payload, cacheControl = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return reply(res, 400, { error: "invalid_coordinates" });
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    format: "jsonv2",
    zoom: "3",
    addressdetails: "1",
    accept_language: "en"
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Tesla GPS PWA/2.2 (OpenStreetMap address lookup)"
      },
      signal: controller.signal
    });
    if (!upstream.ok) return reply(res, 502, { error: "country_lookup_failed" });
    const result = await upstream.json();
    const countryCode = String(result.address && result.address.country_code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return reply(res, 404, { error: "country_not_found" });
    return reply(res, 200, { countryCode }, "public, s-maxage=900, stale-while-revalidate=1800");
  } catch (error) {
    const code = error && error.name === "AbortError" ? "country_lookup_timeout" : "country_lookup_failed";
    return reply(res, 503, { error: code });
  } finally {
    clearTimeout(timer);
  }
};

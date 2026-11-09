function reply(res, status, payload, cacheControl = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  const q = String(req.query.q || "").trim();
  const countrycodes = String(req.query.countrycodes || "")
    .split(",")
    .map(code => code.trim().toLowerCase())
    .filter(code => /^[a-z]{2}$/.test(code));
  if (q.length < 3 || q.length > 180 || !countrycodes.length) {
    return reply(res, 400, { error: "invalid_search" });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "12",
    addressdetails: "1",
    accept_language: "fr",
    countrycodes: countrycodes.join(",")
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Tesla GPS PWA/2.2 (OpenStreetMap address suggestions)"
      },
      signal: controller.signal
    });
    if (!upstream.ok) return reply(res, 502, { error: "address_search_failed" });
    const results = await upstream.json();
    return reply(res, 200, Array.isArray(results) ? results : [], "public, s-maxage=30, stale-while-revalidate=60");
  } catch (error) {
    const code = error && error.name === "AbortError" ? "address_search_timeout" : "address_search_failed";
    return reply(res, 503, { error: code });
  } finally {
    clearTimeout(timer);
  }
};

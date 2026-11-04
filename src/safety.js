(() => {
  "use strict";
  const DB_NAME = "vector-safety-cache";
  const DB_VERSION = 1;
  const CELL_SIZE = 0.2;
  const CELL_TTL = 6 * 60 * 60 * 1000;
  const COUNTRY_TTL = 24 * 60 * 60 * 1000;
  const memoryCells = new Map();
  let dbPromise;
  let lastContextKey = "";
  let lastContext = null;

  const rules = {
    BE: { mode: "exact", label: "Belgique" },
    ES: { mode: "exact", label: "Espagne" },
    FR: { mode: "zones", label: "France" },
    DE: { mode: "off", label: "Allemagne" },
    CH: { mode: "off", label: "Suisse" },
    US: { mode: "zones", label: "États-Unis" }
  };

  function openDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("cells")) db.createObjectStore("cells", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  async function readCell(key) {
    const db = await openDb();
    if (!db) return memoryCells.get(key) || null;
    return new Promise((resolve) => {
      const request = db.transaction("cells", "readonly").objectStore("cells").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(memoryCells.get(key) || null);
    });
  }

  async function writeCell(value) {
    memoryCells.set(value.key, value);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction("cells", "readwrite");
      tx.objectStore("cells").put(value);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function clearCells() {
    memoryCells.clear();
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction("cells", "readwrite");
      tx.objectStore("cells").clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  function countryGridKey(lat, lon) {
    return Math.floor(lat * 100) + ":" + Math.floor(lon * 100);
  }

  async function detectCountry(lat, lon) {
    const key = countryGridKey(lat, lon);
    try {
      const stored = JSON.parse(localStorage.getItem("vector-country-cache") || "null");
      if (stored && stored.key === key && Date.now() - stored.at < COUNTRY_TTL) return stored.code;
    } catch (_) {}
    try {
      const url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&lat=" +
        encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lon);
      const response = await fetch(url, { headers: { "Accept-Language": "fr-BE,fr;q=0.9" } });
      if (!response.ok) throw new Error("country lookup failed");
      const data = await response.json();
      const code = String(data.address && data.address.country_code || "").toUpperCase();
      if (!code) throw new Error("country missing");
      try { localStorage.setItem("vector-country-cache", JSON.stringify({ key, code, at: Date.now() })); } catch (_) {}
      return code;
    } catch (_) {
      return "ZZ";
    }
  }

  function pointType(tags) {
    if (!tags) return null;
    if (tags.highway === "speed_camera") {
      const type = String(tags["camera:type"] || tags["speed_camera:type"] || "").toLowerCase();
      if (type.includes("mobile") || tags.mobile === "yes") return null;
      return "speed-camera";
    }
    if (tags.enforcement === "traffic_signals") return "redlight-camera";
    if (tags.hazard || tags.highway === "construction" || tags.construction) return "road-hazard";
    return null;
  }

  function positionOf(element) {
    if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [element.lon, element.lat];
    if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) return [element.center.lon, element.center.lat];
    if (Array.isArray(element.geometry) && element.geometry.length) {
      const valid = element.geometry.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (!valid.length) return null;
      return [valid.reduce((sum, p) => sum + p.lon, 0) / valid.length, valid.reduce((sum, p) => sum + p.lat, 0) / valid.length];
    }
    return null;
  }

  function haversine(a, b) {
    const rad = x => x * Math.PI / 180;
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  }

  function projectToLine(point, coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const latScale = 111320, lonScale = 111320 * Math.cos(point[1] * Math.PI / 180);
    let best = { distance: Infinity, along: 0 }, travelled = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const ax = (a[0] - point[0]) * lonScale, ay = (a[1] - point[1]) * latScale;
      const bx = (b[0] - point[0]) * lonScale, by = (b[1] - point[1]) * latScale;
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      const x = ax + t * dx, y = ay + t * dy;
      const segmentLength = haversine(a, b);
      const distance = Math.hypot(x, y);
      if (distance < best.distance) best = { distance, along: travelled + t * segmentLength };
      travelled += segmentLength;
    }
    return { distance: best.distance, along: best.along, total: travelled };
  }

  function sliceLine(coords, from, to) {
    if (!Array.isArray(coords) || coords.length < 2 || to <= from) return [];
    const output = [];
    let travelled = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i], segment = haversine(a, b);
      const start = Math.max(from, travelled), end = Math.min(to, travelled + segment);
      if (end > start && segment > 0) {
        const t0 = (start - travelled) / segment, t1 = (end - travelled) / segment;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        if (!output.length) output.push(p0);
        output.push(p1);
      }
      travelled += segment;
      if (travelled >= to) break;
    }
    return output;
  }

  function parseSpeed(value) {
    if (!value) return null;
    const text = String(value).trim().toLowerCase();
    const match = text.match(/(\d+(?:[.,]\d+)?)/);
    if (!match) return null;
    let speed = Number(match[1].replace(",", "."));
    if (text.includes("mph")) speed *= 1.60934;
    return Number.isFinite(speed) ? Math.round(speed) : null;
  }

  function associateRoad(point, roads) {
    let best = null, bestDistance = Infinity;
    for (const road of roads) {
      const coords = (road.geometry || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lon, p.lat]);
      if (coords.length < 2) continue;
      const projected = projectToLine(point, coords);
      if (projected && projected.distance < bestDistance) {
        bestDistance = projected.distance;
        best = road;
      }
    }
    if (bestDistance > 70) return { roadClass: "", speedLimit: null };
    return { roadClass: best.tags && best.tags.highway || "", speedLimit: parseSpeed(best.tags && best.tags.maxspeed) };
  }

  function parsePowerKw(tags) {
    const keys = ["charging_station:output", "socket:tesla_supercharger:output", "socket:ccs:output", "socket:type2:output", "socket:chademo:output", "max_power"];
    for (const key of keys) {
      const value = tags && tags[key];
      if (!value) continue;
      const match = String(value).match(/(\d+(?:[.,]\d+)?)/);
      if (!match) continue;
      let amount = Number(match[1].replace(",", "."));
      if (/\bw\b/i.test(String(value)) && !/\bkw\b/i.test(String(value))) amount /= 1000;
      if (amount > 1000) amount /= 1000;
      if (Number.isFinite(amount) && amount > 0) return Math.round(amount);
    }
    return null;
  }

  function classifyMode(country) {
    return rules[country] || { mode: "zones", label: country === "ZZ" ? "pays non déterminé" : country };
  }

  async function loadCell(lat, lon, includeCameras) {
    const cellLat = Math.floor(lat / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
    const cellLon = Math.floor(lon / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
    const key = cellLat.toFixed(1) + ":" + cellLon.toFixed(1) + ":" + (includeCameras ? "cameras" : "hazards");
    const cached = await readCell(key);
    const fresh = cached && Date.now() - cached.at < CELL_TTL;
    if (fresh) return { elements: cached.elements, stale: false, source: "IndexedDB" };
    if (!navigator.onLine) return cached ? { elements: cached.elements, stale: true, source: "IndexedDB" } : { elements: [], stale: true, source: "aucune donnée hors ligne" };
    try {
      const query = "/api/safety-zones?lat=" + cellLat.toFixed(1) + "&lon=" + cellLon.toFixed(1) + "&cameras=" + (includeCameras ? "1" : "0");
      const response = await fetch(query, { cache: "no-store" });
      if (!response.ok) throw new Error("safety api unavailable");
      const data = await response.json();
      const value = { key, at: Date.now(), elements: Array.isArray(data.elements) ? data.elements : [] };
      await writeCell(value);
      return { elements: value.elements, stale: false, source: "Overpass" };
    } catch (_) {
      return cached ? { elements: cached.elements, stale: true, source: "IndexedDB" } : { elements: [], stale: true, source: "aucune donnée hors ligne" };
    }
  }

  async function update(location) {
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
    const country = await detectCountry(location.latitude, location.longitude);
    const rule = classifyMode(country);
    const includeCameras = rule.mode !== "off" && country !== "ZZ";
    const contextKey = country + ":" + Math.floor(location.latitude / CELL_SIZE) + ":" + Math.floor(location.longitude / CELL_SIZE) + ":" + includeCameras;
    if (lastContextKey === contextKey && lastContext) return lastContext;
    if (rule.mode === "off") await clearCells();
    const loaded = await loadCell(location.latitude, location.longitude, includeCameras);
    const elements = loaded.elements;
    const roads = elements.filter(e => e.type === "way" && e.tags && e.tags.highway && Array.isArray(e.geometry));
    const features = [];
    const chargers = [];
    for (const element of elements) {
      const chargerTags = element.tags || {};
      if (chargerTags.amenity === "charging_station") {
        const point = positionOf(element);
        if (point) chargers.push({
          id: String(element.type) + "/" + String(element.id),
          point,
          name: chargerTags.name || chargerTags.operator || chargerTags.brand || "",
          powerKw: parsePowerKw(chargerTags),
          tesla: /tesla|supercharger/i.test([chargerTags.name, chargerTags.operator, chargerTags.brand, chargerTags.network].filter(Boolean).join(" "))
        });
        continue;
      }
      const tags = element.tags || {};
      const kind = pointType(tags);
      if (!kind) continue;
      if ((country === "DE" || country === "CH") && kind !== "road-hazard") continue;
      const point = positionOf(element);
      if (!point) continue;
      const road = associateRoad(point, roads);
      features.push({ id: String(element.type) + "/" + String(element.id), kind, point, tags, roadClass: road.roadClass, speedLimit: road.speedLimit });
    }
    lastContextKey = contextKey;
    lastContext = { country, countryLabel: rule.label, mode: rule.mode, features, roads, chargers, stale: loaded.stale, dataSource: loaded.source };
    return lastContext;
  }

  function zoneLength(feature, country) {
    if (feature.kind === "road-hazard") return 400;
    const road = feature.roadClass;
    if (road === "motorway" || road === "motorway_link" || road === "trunk" || road === "trunk_link") return 4000;
    if (road === "residential" || road === "living_street" || road === "pedestrian" || road === "service") return 300;
    return 2000;
  }

  function evaluate(context, location, speedMetersPerSecond, routeCoords) {
    if (!context || !location) return { alert: null, points: [], zones: [], speedLimit: null };
    const current = [location.longitude, location.latitude];
    const speedKmh = Math.max(0, (speedMetersPerSecond || 0) * 3.6);
    const lookAhead = Math.max(450, Math.min(1800, speedKmh * 25 / 3.6));
    const points = [], zones = [], candidates = [];
    let currentProjection = null;
    if (Array.isArray(routeCoords) && routeCoords.length > 1) currentProjection = projectToLine(current, routeCoords);
    let speedLimit = null;

    for (const feature of context.features) {
      const straightDistance = haversine(current, feature.point);
      if (feature.kind !== "road-hazard" && context.mode === "off") continue;
      const exact = context.mode === "exact" && feature.kind === "speed-camera";
      const exactLight = context.country === "BE" && context.mode === "exact" && feature.kind === "redlight-camera";
      const precise = exact || exactLight;
      let along = straightDistance, remaining = straightDistance, routeDistance = Infinity, routePosition = null;
      if (currentProjection && routeCoords) {
        const hit = projectToLine(feature.point, routeCoords);
        if (!hit || hit.distance > 85) continue;
        along = hit.along;
        routeDistance = hit.distance;
        remaining = along - currentProjection.along;
        routePosition = hit;
      } else {
        if (context.mode === "zones" && feature.kind !== "road-hazard") continue;
      }
      if (feature.speedLimit && (speedLimit === null || routeDistance < 100)) speedLimit = feature.speedLimit;
      if (remaining < -60) continue;

      if (precise) {
        if (straightDistance <= 5000) points.push({ type: "Feature", geometry: { type: "Point", coordinates: feature.point }, properties: { kind: feature.kind, id: feature.id } });
        if (remaining <= lookAhead) candidates.push({ key: feature.id, kind: feature.kind, precise: true, distance: Math.max(0, remaining), speedLimit: feature.speedLimit, roadClass: feature.roadClass, point: feature.point });
      } else {
        const length = zoneLength(feature, context.country);
        let start = along - length / 2, end = along + length / 2;
        if (currentProjection) {
          start = Math.max(currentProjection.along, start);
          end = Math.min(currentProjection.total, end);
          const distanceToStart = Math.max(0, along - length / 2 - currentProjection.along);
          if (end <= currentProjection.along || distanceToStart > lookAhead) continue;
          const segment = sliceLine(routeCoords, start, end);
          if (segment.length > 1) zones.push({ type: "Feature", geometry: { type: "LineString", coordinates: segment }, properties: { kind: feature.kind, id: feature.id } });
          candidates.push({ key: feature.id, kind: feature.kind, precise: false, distance: distanceToStart, length, speedLimit: feature.speedLimit, roadClass: feature.roadClass, point: feature.point });
        } else if (feature.kind === "road-hazard" && straightDistance <= lookAhead) {
          candidates.push({ key: feature.id, kind: feature.kind, precise: false, distance: straightDistance, length, speedLimit: feature.speedLimit, roadClass: feature.roadClass, point: feature.point });
        }
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return { alert: candidates[0] || null, points, zones, speedLimit, country: context.country, countryLabel: context.countryLabel, mode: context.mode, stale: context.stale };
  }

  window.SafetyRadar = { update, evaluate, clearCells };
})();
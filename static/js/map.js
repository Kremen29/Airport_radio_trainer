/* Prague Airport diagram drawn from the local OSM GeoJSON. */

class AirportMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.features = [];
    this.route = null;
    this.aircraft = null;
    this.showLineup = false;
    this.showTakeoff = false;
    this.goal = "hold";
    this.follow = false;
    this.scale = 1;
    this.camX = 0;
    this.camY = 0;
    this.minScale = 0.05;
    this.maxScale = 8;
    this.originLat = 50.1;
    this.originLon = 14.26;
    this.ready = false;
    this._anim = 0;
    this._pointers = new Map();
    this._pinch = null;
    this._labels = [];
    this.onFollowChange = null;
    this.pen = false;
    this.explore = false;
    this.onPick = null;
    this._down = null;
    this.userPoints = [];
    this.userRunway = false;
    this._drawingStroke = false;
    this._bind();
  }

  load(airport) {
    this.features = airport.geojson.features;
    this.route = airport.route;
    const start = airport.route.initial.position;
    this.aircraft = {
      lon: start[0],
      lat: start[1],
      heading: airport.route.initial.heading_deg,
    };
    this.originLat = start[1];
    this.originLon = start[0];
    this.ready = true;
    this.resize();
    this.fit();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.ready) this.draw();
  }

  fit() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const consider = (lon, lat) => {
      const world = this.toWorld(lat, lon);
      minX = Math.min(minX, world.x);
      maxX = Math.max(maxX, world.x);
      minY = Math.min(minY, world.y);
      maxY = Math.max(maxY, world.y);
    };
    this.features.forEach((feature) => {
      if (feature.properties.aeroway === "parking_position" || feature.properties.aeroway === "holding_position") return;
      this.eachLonLat(feature, consider);
    });
    const pad = 48;
    const worldW = Math.max(100, maxX - minX);
    const worldH = Math.max(100, maxY - minY);
    this.scale = Math.min((this.cssWidth - pad) / worldW, (this.cssHeight - pad) / worldH);
    this.camX = (minX + maxX) / 2;
    this.camY = (minY + maxY) / 2;
    this.minScale = this.scale * 0.7;
    this.maxScale = this.scale * 30;
    this.draw();
  }

  snap(position) {
    const paths = this.route.paths;
    const pick = {
      stand: this.route.initial.position,
      apron: paths.pushback.coordinates.at(-1),
      hold: paths.taxi.coordinates.at(-1),
      runway: paths.lineup.coordinates.at(-1),
      airborne: paths.takeoff.coordinates.at(-1),
    }[position] || this.route.initial.position;
    this.aircraft.lon = pick[0];
    this.aircraft.lat = pick[1];
    if (position === "stand") {
      this.aircraft.heading = this.route.initial.heading_deg;
    } else if (position === "apron") {
      this.aircraft.heading = (this.bearingOf(paths.pushback.coordinates) + 180) % 360;
    } else {
      const key = position === "hold" ? "taxi" : position === "runway" ? "lineup" : "takeoff";
      this.aircraft.heading = this.bearingOf(paths[key].coordinates);
    }
    this.draw();
  }

  play(movement, multiplier, onDone) {
    cancelAnimationFrame(this._anim);
    const coords = movement.coordinates;
    const cumulative = [0];
    for (let i = 1; i < coords.length; i += 1) {
      cumulative.push(cumulative[i - 1] + this.meters(coords[i - 1], coords[i]));
    }
    const total = cumulative.at(-1) || 1;
    let distance = 0;
    let speed = movement.action === "pushback" ? 14 : movement.action === "lineup" ? 22 : 36;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (movement.action === "takeoff") speed = Math.min(95, speed + 7 * dt);
      distance += speed * multiplier * dt;
      const sample = this.sample(coords, cumulative, Math.min(distance, total));
      let heading = sample.bearing;
      if (movement.reverse) heading = (heading + 180) % 360;
      this.aircraft.lon = sample.lon;
      this.aircraft.lat = sample.lat;
      this.aircraft.heading = this.lerpAngle(this.aircraft.heading, heading, 1 - Math.exp(-7 * dt));
      if (this.follow) {
        const world = this.toWorld(sample.lat, sample.lon);
        this.camX = world.x;
        this.camY = world.y;
      }
      this.draw();
      if (distance >= total) {
        onDone();
        return;
      }
      this._anim = requestAnimationFrame(step);
    };
    this._anim = requestAnimationFrame(step);
  }

  stop() {
    cancelAnimationFrame(this._anim);
  }

  sample(coords, cumulative, distance) {
    if (distance <= 0) {
      return { lon: coords[0][0], lat: coords[0][1], bearing: this.bearingOf(coords) };
    }
    let index = 1;
    while (index < cumulative.length && cumulative[index] < distance) index += 1;
    if (index >= coords.length) {
      return { lon: coords.at(-1)[0], lat: coords.at(-1)[1], bearing: this.bearingOf(coords.slice(-2)) };
    }
    const span = cumulative[index] - cumulative[index - 1] || 1;
    const t = (distance - cumulative[index - 1]) / span;
    const a = coords[index - 1];
    const b = coords[index];
    return {
      lon: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
      bearing: this.bearingLonLat(a, b),
    };
  }

  draw() {
    if (!this.ready) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = "#e7efe4";
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this._labels = [];
    const order = ["apron", "hangar", "taxiway", "parking_position", "runway", "terminal"];
    order.forEach((kind) => {
      this.features.forEach((feature) => {
        if (feature.properties.aeroway === kind) this.drawFeature(feature);
      });
    });
    this.drawRoute();
    this.drawUserPath();
    this.drawHold();
    this.drawLabels();
    this.drawAircraft();
  }

  drawFeature(feature) {
    const kind = feature.properties.aeroway;
    const ctx = this.ctx;
    if (feature.geometry.type === "Point") {
      if (this.explore && feature.properties.aeroway === "holding_position" && this.metersPerPx() < 6) {
        const pair = feature.geometry.coordinates;
        const screen = this.toScreen(pair[1], pair[0]);
        ctx.fillStyle = "#c4126b";
        ctx.fillRect(screen.x - 3, screen.y - 3, 6, 6);
        this._labels.push({ x: screen.x, y: screen.y - 10, text: "Hold", strong: Boolean(feature.properties.trainer_hold) });
      }
      return;
    }
    const rings = feature.geometry.type === "Polygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
    rings.forEach((ring) => {
      if (ring.length < 2) return;
      ctx.beginPath();
      ring.forEach((pair, index) => {
        const screen = this.toScreen(pair[1], pair[0]);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      if (feature.geometry.type === "Polygon") {
        ctx.closePath();
        ctx.fillStyle = kind === "terminal" ? "#d9c7b4" : kind === "hangar" ? "#e4d3c4" : "#e3d5c4";
        ctx.fill();
        ctx.strokeStyle = kind === "terminal" ? "#1b2740" : "rgba(27,39,64,0.25)";
        ctx.lineWidth = kind === "terminal" ? 1.4 : 1;
        ctx.stroke();
      } else if (kind === "runway") {
        ctx.strokeStyle = "#243049";
        ctx.lineWidth = Math.max(5, this.metersToPx(45));
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([10, 12]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (kind === "taxiway") {
        ctx.strokeStyle = "#8b97ab";
        ctx.lineWidth = Math.max(1.6, this.metersToPx(18));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      } else if (kind === "parking_position") {
        const stand = feature.properties.ref === this.route.stand.ref;
        ctx.strokeStyle = stand ? "#c4126b" : "rgba(27,39,64,0.28)";
        ctx.lineWidth = stand ? 2.4 : 1;
        ctx.stroke();
      }
    });
    const labelZoom = this.explore ? 14 : 5;
    if (kind === "taxiway" && feature.properties.ref && this.metersPerPx() < labelZoom) {
      this.queueLineLabel(feature.geometry.coordinates, feature.properties.ref, false);
    }
    if (kind === "taxiway" && !feature.properties.ref && this.explore && this.metersPerPx() < 2.2) {
      this.queueLineLabel(feature.geometry.coordinates, "unnamed", false);
    }
    if (kind === "terminal" && (feature.properties.display_name || this.explore)) {
      this.queueCentroid(feature, feature.properties.display_name || "Terminal");
    }
    if (kind === "parking_position" && feature.properties.ref && (feature.properties.ref === this.route.stand.ref || (this.explore && this.metersPerPx() < 3))) {
      this.queueLineLabel(feature.geometry.coordinates, "Stand " + feature.properties.ref, feature.properties.ref === this.route.stand.ref);
    }
  }

  drawRoute() {
    const taxi = this.route.paths.taxi.coordinates;
    this.strokePath(taxi, "#c4126b", Math.max(3, this.metersToPx(10)), false);
    if (this.showLineup) {
      this.strokePath(this.route.paths.lineup.coordinates, "#c4126b", Math.max(3, this.metersToPx(10)), false);
    } else {
      this.strokePath(this.route.paths.lineup.coordinates, "rgba(27,39,64,0.35)", 1.5, true);
    }
    if (this.showTakeoff) {
      this.strokePath(this.route.paths.takeoff.coordinates, "#c4126b", Math.max(3, this.metersToPx(8)), false);
    }
    const goalPath = this.goal === "takeoff"
      ? this.route.paths.takeoff.coordinates
      : this.goal === "lineup"
        ? this.route.paths.lineup.coordinates
        : taxi;
    const end = goalPath.at(-1);
    const screen = this.toScreen(end[1], end[0]);
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
    this.ctx.strokeStyle = "#c4126b";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  strokePath(coords, color, width, dashed) {
    const ctx = this.ctx;
    ctx.beginPath();
    coords.forEach((pair, index) => {
      const screen = this.toScreen(pair[1], pair[0]);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dashed ? [5, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawUserPath() {
    if (!this.userPoints.length) return;
    this.strokePath(this.userPoints, this.userRunway ? "#9d1834" : "#1d4f91", 4, false);
  }

  setPen(on) {
    this.pen = Boolean(on);
    this.canvas.style.cursor = this.pen ? "crosshair" : "grab";
    this.canvas.parentElement.classList.toggle("pen-on", this.pen);
  }

  hitTest(sx, sy) {
    let best = null;
    let bestDistance = 26;
    this.features.forEach((feature) => {
      const distance = this.featureScreenDistance(feature, sx, sy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = feature;
      }
    });
    return best;
  }

  featureScreenDistance(feature, sx, sy) {
    const geom = feature.geometry;
    if (!geom) return 1e9;
    if (geom.type === "Point") {
      const screen = this.toScreen(geom.coordinates[1], geom.coordinates[0]);
      return Math.hypot(screen.x - sx, screen.y - sy);
    }
    const lines = geom.type === "Polygon" ? geom.coordinates : [geom.coordinates];
    let best = 1e9;
    lines.forEach((line) => {
      for (let index = 1; index < line.length; index += 1) {
        const a = this.toScreen(line[index - 1][1], line[index - 1][0]);
        const b = this.toScreen(line[index][1], line[index][0]);
        best = Math.min(best, this.distToSeg(sx, sy, a.x, a.y, b.x, b.y));
      }
    });
    return best;
  }

  distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const length = vx * vx + vy * vy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length));
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }

  screenToLonLat(sx, sy) {
    const world = this.fromScreen(sx, sy);
    const lon = world.x / (Math.cos(this.originLat * Math.PI / 180) * 111320) + this.originLon;
    const lat = world.y / 110540 + this.originLat;
    return [lon, lat];
  }

  drawHold() {
    const taxi = this.route.paths.taxi.coordinates;
    if (taxi.length < 2) return;
    const a = taxi.at(-2);
    const b = taxi.at(-1);
    const bearing = this.bearingLonLat(a, b) * Math.PI / 180;
    const across = 26;
    const dx = Math.sin(bearing);
    const dy = Math.cos(bearing);
    const px = -dy;
    const py = dx;
    const ctx = this.ctx;
    ctx.strokeStyle = "#c4126b";
    ctx.lineWidth = 3;
    [6, -6].forEach((shift) => {
      const mid = this.offset(b, dx * shift, dy * shift);
      const left = this.offset(mid, px * across, py * across);
      const right = this.offset(mid, -px * across, -py * across);
      const s1 = this.toScreen(left[1], left[0]);
      const s2 = this.toScreen(right[1], right[0]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    });
    const label = this.toScreen(b[1], b[0]);
    this._labels.push({ x: label.x + 10, y: label.y - 10, text: "HOLD 24", strong: true });
  }

  drawLabels() {
    const placed = [];
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.runwayLabels();
    this._labels.forEach((label) => {
      ctx.font = label.strong ? "700 12px Segoe UI, sans-serif" : "600 12px Segoe UI, sans-serif";
      const width = ctx.measureText(label.text).width + 8;
      const box = { x: label.x - width / 2, y: label.y - 8, w: width, h: 16 };
      if (placed.some((item) => this.overlaps(item, box))) return;
      if (box.x < 0 || box.y < 0 || box.x + box.w > this.cssWidth || box.y + box.h > this.cssHeight) return;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(231,239,228,0.92)";
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.strong ? "#c4126b" : "#1b2740";
      ctx.fillText(label.text, label.x, label.y);
    });
  }

  runwayLabels() {
    const groups = new Map();
    this.features.forEach((feature) => {
      if (feature.properties.aeroway !== "runway" || !feature.properties.ref) return;
      const ref = feature.properties.ref;
      const line = feature.geometry.coordinates;
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(line);
    });
    groups.forEach((lines, ref) => {
      const stitched = this.stitch(lines);
      if (stitched.length < 2) return;
      const parts = ref.split("/");
      if (parts.length !== 2) return;
      const start = stitched[0];
      const end = stitched.at(-1);
      const outbound = this.bearingLonLat(start, end);
      const heads = parts.map((item) => Number(item) * 10);
      const startLabel = this.angleDiff(outbound, heads[0]) < this.angleDiff(outbound, heads[1]) ? parts[0] : parts[1];
      const endLabel = startLabel === parts[0] ? parts[1] : parts[0];
      const nearStart = this.pointAlong(stitched, 180);
      const nearEnd = this.pointAlong(stitched, Math.max(0, this.pathLength(stitched) - 180));
      const s1 = this.toScreen(nearStart[1], nearStart[0]);
      const s2 = this.toScreen(nearEnd[1], nearEnd[0]);
      this._labels.push({ x: s1.x, y: s1.y, text: startLabel, strong: false });
      this._labels.push({ x: s2.x, y: s2.y, text: endLabel, strong: false });
    });
  }

  drawAircraft() {
    const screen = this.toScreen(this.aircraft.lat, this.aircraft.lon);
    const type = (this.aircraftStyle && this.aircraftStyle.type) || "A320";
    const spec = (typeof AIRCRAFT_TYPES !== "undefined" && AIRCRAFT_TYPES[type]) || { span: 36 };
    const spanPx = Math.max(26, Math.min(150, this.metersToPx(spec.span)));
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.aircraft.heading * Math.PI / 180);
    if (typeof drawAircraftIcon === "function") {
      drawAircraftIcon(ctx, spanPx, type, this.aircraftStyle && this.aircraftStyle.livery);
    }
    ctx.restore();
  }

  setAircraftStyle(style) {
    this.aircraftStyle = style;
    if (this.ready) this.draw();
  }

  queueLineLabel(coords, text, strong) {
    if (!coords || coords.length < 2) return;
    let best = 0;
    let mid = coords[0];
    for (let i = 1; i < coords.length; i += 1) {
      const length = this.meters(coords[i - 1], coords[i]);
      if (length > best) {
        best = length;
        mid = [
          (coords[i - 1][0] + coords[i][0]) / 2,
          (coords[i - 1][1] + coords[i][1]) / 2,
        ];
      }
    }
    const screen = this.toScreen(mid[1], mid[0]);
    this._labels.push({ x: screen.x, y: screen.y, text, strong });
  }

  queueCentroid(feature, text) {
    const ring = feature.geometry.coordinates[0];
    let lon = 0;
    let lat = 0;
    ring.forEach((pair) => { lon += pair[0]; lat += pair[1]; });
    const screen = this.toScreen(lat / ring.length, lon / ring.length);
    this._labels.push({ x: screen.x, y: screen.y, text, strong: false });
  }

  stitch(lines) {
    const pool = lines.map((line) => line.slice());
    let chain = pool.shift();
    let guard = 0;
    while (pool.length && guard < 12) {
      guard += 1;
      let joined = false;
      for (let i = 0; i < pool.length; i += 1) {
        const line = pool[i];
        if (this.meters(chain.at(-1), line[0]) < 40) {
          chain = chain.concat(line.slice(1));
          pool.splice(i, 1);
          joined = true;
          break;
        }
        if (this.meters(chain.at(-1), line.at(-1)) < 40) {
          chain = chain.concat(line.slice(0, -1).reverse());
          pool.splice(i, 1);
          joined = true;
          break;
        }
      }
      if (!joined) break;
    }
    return chain;
  }

  eachLonLat(feature, fn) {
    const walk = (coords) => {
      if (typeof coords[0] === "number") fn(coords[0], coords[1]);
      else coords.forEach(walk);
    };
    walk(feature.geometry.coordinates);
  }

  toWorld(lat, lon) {
    const x = (lon - this.originLon) * Math.cos(this.originLat * Math.PI / 180) * 111320;
    const y = (lat - this.originLat) * 110540;
    return { x, y };
  }

  toScreen(lat, lon) {
    const world = this.toWorld(lat, lon);
    return {
      x: (world.x - this.camX) * this.scale + this.cssWidth / 2,
      y: (this.camY - world.y) * this.scale + this.cssHeight / 2,
    };
  }

  fromScreen(sx, sy) {
    return {
      x: (sx - this.cssWidth / 2) / this.scale + this.camX,
      y: this.camY - (sy - this.cssHeight / 2) / this.scale,
    };
  }

  metersToPx(meters) {
    return meters * this.scale;
  }

  metersPerPx() {
    return 1 / this.scale;
  }

  meters(a, b) {
    const lat1 = a[1];
    const lat2 = b[1];
    const x = (b[0] - a[0]) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180) * 111320;
    const y = (lat2 - lat1) * 110540;
    return Math.hypot(x, y);
  }

  bearingLonLat(a, b) {
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dlon = (b[0] - a[0]) * Math.PI / 180;
    const y = Math.sin(dlon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  pathLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) total += this.meters(coords[i - 1], coords[i]);
    return total;
  }

  pointAlong(coords, distance) {
    let walked = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const step = this.meters(coords[i - 1], coords[i]);
      if (walked + step >= distance || i === coords.length - 1) {
        const t = step === 0 ? 0 : Math.max(0, Math.min(1, (distance - walked) / step));
        return [
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        ];
      }
      walked += step;
    }
    return coords.at(-1);
  }

  bearingOf(coords) {
    if (!coords || coords.length < 2) return this.aircraft ? this.aircraft.heading : 0;
    return this.bearingLonLat(coords.at(-2), coords.at(-1));
  }

  lerpAngle(from, to, t) {
    const delta = ((to - from + 540) % 360) - 180;
    return (from + delta * t + 360) % 360;
  }

  angleDiff(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  offset(lonlat, east, north) {
    const lat = lonlat[1];
    return [
      lonlat[0] + east / (111320 * Math.cos(lat * Math.PI / 180)),
      lonlat[1] + north / 110540,
    ];
  }

  zoomAt(sx, sy, factor) {
    const world = this.fromScreen(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    this.camX = world.x - (sx - this.cssWidth / 2) / this.scale;
    this.camY = world.y + (sy - this.cssHeight / 2) / this.scale;
    this.draw();
  }

  _bind() {
    const canvas = this.canvas;
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.follow = false;
      if (this.onFollowChange) this.onFollowChange(false);
      this.zoomAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this._down = { x: event.offsetX, y: event.offsetY };
      if (this.pen) {
        event.preventDefault();
        this._drawingStroke = true;
        this.userPoints.push(this.screenToLonLat(event.offsetX, event.offsetY));
        this.draw();
        return;
      }
      this._pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      if (this._pointers.size === 2) {
        const [p, q] = [...this._pointers.values()];
        this._pinch = { dist: Math.hypot(p.x - q.x, p.y - q.y), scale: this.scale };
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.pen && this._drawingStroke) {
        event.preventDefault();
        const next = this.screenToLonLat(event.offsetX, event.offsetY);
        const prev = this.userPoints[this.userPoints.length - 1];
        if (!prev || this.meters(prev, next) > 4) this.userPoints.push(next);
        this.draw();
        return;
      }
      if (!this._pointers.has(event.pointerId)) return;
      const previous = this._pointers.get(event.pointerId);
      this._pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      if (this._pointers.size === 2 && this._pinch) {
        const [p, q] = [...this._pointers.values()];
        const dist = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        const midX = (p.x + q.x) / 2;
        const midY = (p.y + q.y) / 2;
        this.zoomAt(midX, midY, dist / this._pinch.dist);
        this._pinch.dist = dist;
        return;
      }
      if (this._pointers.size === 1) {
        this.follow = false;
        if (this.onFollowChange) this.onFollowChange(false);
        this.camX -= (event.offsetX - previous.x) / this.scale;
        this.camY += (event.offsetY - previous.y) / this.scale;
        this.draw();
      }
    });
    const end = (event) => {
      const start = this._down;
      const moved = start ? Math.hypot(event.offsetX - start.x, event.offsetY - start.y) : 99;
      this._drawingStroke = false;
      this._pointers.delete(event.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (!this.pen && this.explore && moved < 8 && this.onPick) {
        const feature = this.hitTest(event.offsetX, event.offsetY);
        if (feature) this.onPick(feature);
      }
    };
    canvas.addEventListener("touchmove", (event) => {
      if (this.pen) event.preventDefault();
    }, { passive: false });
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => this.resize());
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }
  }
}

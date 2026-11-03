/* Top-down planforms from published length, span, and sweep.
   Colours are a made-up training livery, not an airline.
   Sources for the proportions: Airbus and Boeing aircraft characteristics
   (A320-200 with sharklets, A330-300, A350-900, 737-800, A380-800). */

const AIRCRAFT_TYPES = {
  A320: {
    name: "Airbus A320",
    engines: 2,
    span: 35.8,
    length: 37.57,
    fuselage: 3.95,
    sweep: 25,
    area: 122.6,
    taper: 0.22,
    wingAt: 0.34,
    stations: [0.36],
    nacelleD: 2.05,
    nacelleL: 4.2,
    hsSpan: 12.5,
    hsChord: 2.8,
    winglet: "sharklet",
    noseLen: 0.12,
    nosePinch: 0.35,
    note: "Short twin jet. Swept wing with sharklets, two engines under the wings, and a normal tail.",
  },
  B737: {
    name: "Boeing 737",
    engines: 2,
    span: 35.8,
    length: 39.5,
    fuselage: 3.76,
    sweep: 25.0,
    area: 124.6,
    taper: 0.22,
    wingAt: 0.40,
    stations: [0.23],
    nacelleD: 1.85,
    nacelleL: 3.6,
    hsSpan: 14.3,
    hsChord: 2.6,
    winglet: "scimitar",
    noseLen: 0.13,
    nosePinch: 0.28,
    note: "737-800 style. Shorter body, blended winglets, and two engines tucked close to the fuselage.",
  },
  A330: {
    name: "Airbus A330",
    engines: 2,
    span: 60.3,
    length: 63.66,
    fuselage: 5.64,
    sweep: 30,
    area: 361.6,
    taper: 0.2,
    wingAt: 0.33,
    stations: [0.34],
    nacelleD: 2.7,
    nacelleL: 5.6,
    hsSpan: 19.0,
    hsChord: 4.4,
    winglet: "raked",
    noseLen: 0.12,
    nosePinch: 0.32,
    note: "Long twin jet. A long wing with raked tips and two large engines.",
  },
  A350: {
    name: "Airbus A350",
    engines: 2,
    span: 64.75,
    length: 66.8,
    fuselage: 5.96,
    sweep: 31.9,
    area: 443,
    taper: 0.18,
    wingAt: 0.31,
    stations: [0.33],
    nacelleD: 3.15,
    nacelleL: 6.0,
    hsSpan: 19.6,
    hsChord: 4.6,
    winglet: "a350",
    noseLen: 0.18,
    nosePinch: 0.16,
    note: "Large twin jet. Curved raked wingtips, two big engines, and a long smooth nose.",
  },
  A380: {
    name: "Airbus A380",
    engines: 4,
    span: 79.75,
    length: 72.72,
    fuselage: 7.14,
    sweep: 33.5,
    area: 845,
    taper: 0.22,
    wingAt: 0.32,
    stations: [0.27, 0.55],
    nacelleD: 3.1,
    nacelleL: 5.8,
    hsSpan: 30.4,
    hsChord: 6.2,
    winglet: "fence",
    noseLen: 0.09,
    nosePinch: 0.62,
    note: "Very large jet. A wide wing with tip fences, four engines, and a wide two-deck body. On the first radio call, pilots add the word Super.",
  },
};

const LIVERY_TAILS = ["#1b2740", "#0e6b4f", "#8e0f4e", "#3d4c6b", "#6b4a1b"];
const LIVERY_ACCENTS = ["#c4126b", "#d4a017", "#2a6f8f", "#c45c26", "#3d6b4f"];
const LIVERY_BODIES = ["#f7f4ef", "#ffffff", "#e7eef2"];

function defaultLivery(type) {
  const index = Object.keys(AIRCRAFT_TYPES).indexOf(type);
  return {
    fuselage: LIVERY_BODIES[index % LIVERY_BODIES.length],
    tail: LIVERY_TAILS[index % LIVERY_TAILS.length],
    accent: LIVERY_ACCENTS[(index + 1) % LIVERY_ACCENTS.length],
  };
}

function randomLivery() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return { fuselage: pick(LIVERY_BODIES), tail: pick(LIVERY_TAILS), accent: pick(LIVERY_ACCENTS) };
}

function mixHex(hex, toward, t) {
  const parse = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const a = parse(hex);
  const b = parse(toward);
  const out = a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
  return `#${out.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function drawAircraftIcon(ctx, pixelSpan, typeId, livery) {
  const type = AIRCRAFT_TYPES[typeId] || AIRCRAFT_TYPES.A320;
  const colors = livery || defaultLivery(typeId);
  const simple = pixelSpan < 34;
  const ppm = pixelSpan / type.span;
  const L = type.length * ppm;
  const W = type.fuselage * ppm;
  const noseY = -L / 2;
  const mean = (type.area / type.span) * ppm;
  const rootC = mean * 2 / (1 + type.taper);
  const tipC = rootC * type.taper;
  const half = pixelSpan / 2;
  const body = W / 2;
  const exposed = half - body;
  const rootLE = noseY + type.wingAt * L;
  const tipLE = rootLE + Math.tan(type.sweep * Math.PI / 180) * exposed;
  const rootTE = rootLE + rootC;
  const tipTE = tipLE + tipC;
  const wing = { body, half, rootLE, rootTE, tipLE, tipTE, rootC };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(27, 39, 64, 0.4)";
  ctx.shadowBlur = simple ? 3 : Math.max(4, pixelSpan * 0.035);
  ctx.shadowOffsetY = 1;

  traceWing(ctx, wing, type.winglet);
  ctx.fillStyle = "#d7dee6";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, pixelSpan * 0.012);
  ctx.strokeStyle = "#1b2740";
  ctx.stroke();
  if (!simple) drawFlapTracks(ctx, wing);

  drawEngines(ctx, type, ppm, wing, colors, simple);
  drawStabilizer(ctx, type, ppm, L, colors, simple);

  const fairing = Math.max(rootC * 0.42, W * 0.7);
  ctx.fillStyle = colors.fuselage;
  ctx.beginPath();
  ctx.ellipse(0, (rootLE + rootTE) / 2, body * 1.35, fairing * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  drawFuselage(ctx, type, L, W, noseY, colors, simple);
  ctx.restore();
}

function traceWing(ctx, wing, kind) {
  const left = wingSide(wing, kind, -1);
  const right = wingSide(wing, kind, 1);
  const leftPath = sideCommands(left, kind);
  const rightPath = sideCommands(right, kind);
  ctx.beginPath();
  ctx.moveTo(left.rootLE[0], left.rootLE[1]);
  leftPath.forEach((cmd) => strokeCmd(ctx, cmd));
  for (let index = rightPath.length - 1; index >= 0; index -= 1) {
    ctx.lineTo(rightPath[index].x, rightPath[index].y);
  }
  ctx.closePath();
}

function strokeCmd(ctx, cmd) {
  ctx.lineTo(cmd.x, cmd.y);
}

function wingSide(wing, kind, sign) {
  const { body, half, rootLE, rootTE, tipLE, tipTE } = wing;
  const frac = kind === "a350" ? 0.76 : 0.86;
  const kink = body + (half - body) * frac;
  const t = (kink - body) / (half - body);
  return {
    sign,
    body,
    half,
    rootLE: [sign * body, rootLE],
    rootTE: [sign * body, rootTE],
    kinkLE: [sign * kink, rootLE + (tipLE - rootLE) * t],
    kinkTE: [sign * kink, rootTE + (tipTE - rootTE) * t],
    tipLE: [sign * half, tipLE],
    tipTE: [sign * half, tipTE],
  };
}

function sideCommands(side, kind) {
  const reach = (side.half - side.body) * 0.09;
  const chord = side.tipTE[1] - side.tipLE[1];
  const cmds = [{ op: "L", x: side.kinkLE[0], y: side.kinkLE[1] }];
  const L = (x, y) => cmds.push({ op: "L", x, y });
  if (kind === "raked") {
    L(side.tipLE[0] + side.sign * reach * 0.2, side.tipLE[1]);
    L(side.tipLE[0] + side.sign * reach, side.tipLE[1] + chord * 0.38);
    L(side.tipTE[0] + side.sign * reach * 0.35, side.tipTE[1]);
  } else if (kind === "a350") {
    L(side.tipLE[0] + side.sign * reach * 0.15, side.tipLE[1] - chord * 0.05);
    L(side.tipLE[0] + side.sign * reach * 1.2, side.tipLE[1] + chord * 0.5);
    L(side.tipTE[0] + side.sign * reach * 0.15, side.tipTE[1] + chord * 0.08);
  } else if (kind === "sharklet") {
    L(side.tipLE[0], side.tipLE[1]);
    L(side.tipLE[0] + side.sign * reach, side.tipLE[1] + chord * 0.18);
    L(side.tipTE[0] + side.sign * reach * 0.4, side.tipTE[1] + chord * 0.05);
    L(side.tipTE[0], side.tipTE[1]);
  } else if (kind === "scimitar") {
    L(side.tipLE[0], side.tipLE[1]);
    L(side.tipLE[0] + side.sign * reach, side.tipLE[1] + chord * 0.06);
    L(side.tipLE[0] + side.sign * reach * 1.2, side.tipLE[1] + chord * 0.42);
    L(side.tipTE[0] + side.sign * reach * 0.15, side.tipTE[1]);
    L(side.tipTE[0] - side.sign * reach * 0.25, side.tipTE[1] + chord * 0.12);
  } else {
    const fence = Math.max(chord * 0.55, (side.half - side.body) * 0.06);
    L(side.tipLE[0], side.tipLE[1]);
    L(side.tipLE[0] + side.sign * fence, side.tipLE[1] + fence * 0.2);
    L(side.tipTE[0] + side.sign * fence, side.tipTE[1] - fence * 0.05);
    L(side.tipTE[0], side.tipTE[1]);
  }
  L(side.kinkTE[0], side.kinkTE[1]);
  L(side.rootTE[0], side.rootTE[1]);
  return cmds;
}

function drawFlapTracks(ctx, wing) {
  const { body, half, rootTE, tipTE } = wing;
  ctx.fillStyle = "#b7c0cc";
  [0.22, 0.42, 0.62, 0.8].forEach((t) => {
    [-1, 1].forEach((side) => {
      const x = side * (body + (half - body) * t);
      const y = rootTE + (tipTE - rootTE) * t;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y + Math.max(2, wing.rootC * 0.08),
        Math.max(0.7, wing.half * 0.012),
        Math.max(1.6, wing.rootC * 0.14),
        0, 0, Math.PI * 2,
      );
      ctx.fill();
    });
  });
}

function drawEngines(ctx, type, ppm, wing, colors, simple) {
  const half = type.span / 2;
  type.stations.forEach((station) => {
    [-1, 1].forEach((side) => {
      const x = side * station * half * ppm;
      const y = wing.rootLE + wing.rootC * 0.48;
      const rx = type.nacelleD * ppm / 2;
      const ry = type.nacelleL * ppm / 2;
      ctx.fillStyle = mixHex(colors.tail, "#1b2740", 0.35);
      ctx.strokeStyle = "#1b2740";
      ctx.lineWidth = Math.max(0.8, rx * 0.12);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!simple) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = Math.max(1, rx * 0.28);
        ctx.beginPath();
        ctx.ellipse(x, y - ry * 0.62, rx * 0.72, ry * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  });
}

function drawStabilizer(ctx, type, ppm, L, colors, simple) {
  const hs = type.hsSpan * ppm / 2;
  const chord = type.hsChord * ppm;
  const tailY = L / 2;
  const rootLE = tailY - chord * 1.35;
  ctx.fillStyle = mixHex(colors.fuselage, "#1b2740", 0.08);
  ctx.strokeStyle = "#1b2740";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rootLE);
  ctx.lineTo(hs, rootLE + chord * 0.55);
  ctx.lineTo(hs * 0.82, rootLE + chord);
  ctx.lineTo(0, rootLE + chord * 0.72);
  ctx.lineTo(-hs * 0.82, rootLE + chord);
  ctx.lineTo(-hs, rootLE + chord * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (!simple) {
    ctx.fillStyle = colors.tail;
    ctx.beginPath();
    ctx.ellipse(0, tailY - L * 0.11, type.fuselage * ppm * 0.16, L * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawFuselage(ctx, type, L, W, noseY, colors, simple) {
  const noseLen = L * type.noseLen;
  const tailLen = L * 0.16;
  const half = W / 2;
  const nosePinch = type.nosePinch;
  ctx.beginPath();
  ctx.moveTo(0, noseY);
  ctx.bezierCurveTo(
    half * nosePinch, noseY + noseLen * 0.15,
    half, noseY + noseLen * 0.72,
    half, noseY + noseLen,
  );
  ctx.lineTo(half, noseY + L - tailLen);
  ctx.quadraticCurveTo(half * 0.7, noseY + L - tailLen * 0.25, 0, noseY + L);
  ctx.quadraticCurveTo(-half * 0.7, noseY + L - tailLen * 0.25, -half, noseY + L - tailLen);
  ctx.lineTo(-half, noseY + noseLen);
  ctx.bezierCurveTo(
    -half, noseY + noseLen * 0.72,
    -half * nosePinch, noseY + noseLen * 0.15,
    0, noseY,
  );
  const gradient = ctx.createLinearGradient(0, noseY, 0, noseY + L);
  gradient.addColorStop(0, mixHex(colors.fuselage, "#ffffff", 0.55));
  gradient.addColorStop(0.18, colors.fuselage);
  gradient.addColorStop(1, mixHex(colors.fuselage, "#1b2740", 0.14));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = Math.max(1, half * 0.08);
  ctx.strokeStyle = "#1b2740";
  ctx.stroke();

  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = Math.max(1.1, half * 0.14);
  ctx.beginPath();
  ctx.moveTo(-half * 0.72, noseY + noseLen);
  ctx.lineTo(-half * 0.72, noseY + L - tailLen);
  ctx.moveTo(half * 0.72, noseY + noseLen);
  ctx.lineTo(half * 0.72, noseY + L - tailLen);
  ctx.stroke();

  ctx.fillStyle = colors.tail;
  ctx.fillRect(-half * 0.22, noseY + L * 0.78, half * 0.44, L * 0.12);

  if (!simple) {
    ctx.strokeStyle = "rgba(27, 39, 64, 0.28)";
    ctx.lineWidth = 1;
    [0.28, 0.46, 0.62].forEach((t) => {
      const y = noseY + L * t;
      ctx.beginPath();
      ctx.moveTo(-half * 0.92, y);
      ctx.lineTo(half * 0.92, y);
      ctx.stroke();
    });
  }
}

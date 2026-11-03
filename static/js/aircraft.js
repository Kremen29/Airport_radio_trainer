/* Top-down silhouettes. Colours are a made-up training livery, not an airline. */

const AIRCRAFT_TYPES = {
  A320: { name: "Airbus A320", engines: 2, span: 36, note: "A short twin-engine passenger jet. Two engines, one under each wing." },
  B737: { name: "Boeing 737", engines: 2, span: 36, note: "A short twin-engine passenger jet, a little narrower than the A320." },
  A330: { name: "Airbus A330", engines: 2, span: 60, note: "A larger twin-engine jet, used on longer flights." },
  A350: { name: "Airbus A350", engines: 2, span: 65, note: "A large twin-engine jet with long wings." },
  A380: { name: "Airbus A380", engines: 4, span: 80, note: "A very large jet with four engines, two under each wing. On a real first radio call, pilots add the word Super after the callsign." },
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

function drawAircraftIcon(ctx, pixelSpan, typeId, livery) {
  const type = AIRCRAFT_TYPES[typeId] || AIRCRAFT_TYPES.A320;
  const colors = livery || defaultLivery(typeId);
  const s = pixelSpan / 2;
  ctx.save();
  ctx.shadowColor = "rgba(27, 39, 64, 0.45)";
  ctx.shadowBlur = Math.max(4, s * 0.15);
  ctx.shadowOffsetY = 1;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.25, s * 0.06);
  ctx.strokeStyle = "#1b2740";

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-s * 0.92, s * 0.08);
  ctx.lineTo(-s * 0.15, -s * 0.18);
  ctx.lineTo(s * 0.15, -s * 0.18);
  ctx.lineTo(s * 0.92, s * 0.08);
  ctx.lineTo(s * 0.72, s * 0.28);
  ctx.lineTo(s * 0.08, s * 0.1);
  ctx.lineTo(-s * 0.08, s * 0.1);
  ctx.lineTo(-s * 0.72, s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const engines = type.engines === 4
    ? [[-0.62, 0.12], [-0.34, 0.04], [0.34, 0.04], [0.62, 0.12]]
    : [[-0.46, 0.08], [0.46, 0.08]];
  ctx.fillStyle = "#243049";
  engines.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.ellipse(s * x, s * y, s * 0.07, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = colors.fuselage;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.02, s * 0.11, s * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.tail;
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, s * 0.48);
  ctx.lineTo(0, s * 0.22);
  ctx.lineTo(s * 0.34, s * 0.48);
  ctx.lineTo(s * 0.08, s * 0.62);
  ctx.lineTo(-s * 0.08, s * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(-s * 0.08, -s * 0.72, s * 0.16, s * 0.12);
  ctx.restore();
}

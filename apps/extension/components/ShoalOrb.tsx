import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface ShoalOrbProps {
  state: OrbState;
  /** Voice level from 0 to 1. Without it, listening and speaking use a simulated level. */
  level?: number;
  /** Number of fish in the ball. */
  count?: number;
  /** Fish size relative to the default; small orbs need smaller fish to stay readable. */
  fishScale?: number;
  className?: string;
}

interface Shape {
  radius: number;
  swim: number;
  band: number;
  wobble: number;
  tilt: number;
}

/** Per-state targets, eased toward each frame. */
const SHAPES: Record<OrbState, Shape> = {
  idle: { radius: 1.0, swim: 1.0, band: 1.0, wobble: 1.0, tilt: 0.35 },
  listening: { radius: 0.86, swim: 0.7, band: 1.0, wobble: 0.5, tilt: 0.15 },
  thinking: { radius: 0.95, swim: 3.2, band: 0.32, wobble: 0.3, tilt: 0.9 },
  speaking: { radius: 1.04, swim: 1.4, band: 1.0, wobble: 1.2, tilt: 0.3 },
};

const BINS = 32;

interface Fish {
  lat0: number;
  lat: number;
  lon: number;
  speed: number;
  phase: number;
  wob: number;
  size: number;
  r: number;
  rv: number;
  bin: number;
  hue: number;
}

function makeFish(n: number): Fish[] {
  const fish: Fish[] = [];
  for (let i = 0; i < n; i++) {
    // Golden spiral for an even spread over the sphere.
    const lat = Math.asin(1 - (2 * (i + 0.5)) / n);
    const lon = i * Math.PI * (3 - Math.sqrt(5));
    fish.push({
      lat0: lat,
      lat,
      lon,
      speed: 0.25 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      wob: 0.6 + Math.random() * 0.8,
      size: 0.8 + Math.random() * 0.45,
      r: 1,
      rv: 0,
      bin: Math.floor(((lon % (2 * Math.PI)) / (2 * Math.PI)) * BINS),
      hue: 188 + Math.random() * 14,
    });
  }
  return fish;
}

function synthLevel(state: OrbState, t: number): number {
  if (state === "speaking") {
    const syll = (0.5 + 0.5 * Math.sin(t * 13.7)) ** 2;
    const word = 0.55 + 0.45 * Math.sin(t * 2.9 + Math.sin(t * 1.3));
    const gate = Math.sin(t * 0.8) > -0.55 ? 1 : 0.08;
    return Math.min(1, syll * word * gate * 1.1);
  }
  if (state === "listening") {
    const syll = (0.5 + 0.5 * Math.sin(t * 11.3 + 1)) ** 2;
    const gate = Math.sin(t * 0.6 + 2) > -0.3 ? 1 : 0.05;
    return syll * gate * 0.6;
  }
  return 0;
}

/** The page follows the system appearance; on a light page the fish turn dark so they stay visible. */
const lightScheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

function fishColor(hue: number, light: number): string {
  return lightScheme?.matches
    ? `hsl(${hue} ${35 + light * 20}% ${58 - light * 36}%)`
    : `hsl(${hue} ${30 + light * 25}% ${22 + light * 62}%)`;
}

function drawFish(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  s: number,
  light: number,
  alpha: number,
  hue: number,
  wag: number,
) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(s * len, s);
  g.globalAlpha = alpha;
  g.fillStyle = fishColor(hue, light);
  g.beginPath();
  g.moveTo(7, 0);
  g.bezierCurveTo(4, -2.6, -2, -2.4, -5, -0.4);
  g.lineTo(-5, 0.4);
  g.bezierCurveTo(-2, 2.4, 4, 2.6, 7, 0);
  g.fill();
  g.beginPath();
  g.moveTo(-4.6, 0);
  g.lineTo(-8.6, -2.4 + wag);
  g.lineTo(-7.6, wag * 0.5);
  g.lineTo(-8.6, 2.4 + wag);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * The Shoal "bait ball": fish milling on a sphere that reacts to the agent state and a voice level.
 * Decorative, so the canvas is hidden from assistive tech; show the state in text alongside it.
 */
export function ShoalOrb({ state, level, count = 150, fishScale = 1, className }: ShoalOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const input = useRef({ state, level });
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    input.current = { state, level };
    redraw.current?.();
  }, [state, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    const fish = makeFish(count);
    const n = fish.length;
    const bins = new Float32Array(BINS);
    const order = fish.map((_, i) => i);
    const depth = new Float32Array(n);
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sa = new Float32Array(n);
    const sl = new Float32Array(n);
    const sk = new Float32Array(n);
    const cur: Shape = { ...SHAPES[input.current.state] };
    const proj = { x: 0, y: 0, z: 0, k: 1 };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let W = 0;
    let H = 0;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let glow = 0;
    let lvl = 0;

    const project = (x: number, y: number, z: number, cx: number, cy: number, R: number, tilt: number) => {
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const y2 = y * ct - z * st;
      const z2 = y * st + z * ct;
      const k = 3.2 / (3.2 - z2);
      proj.x = cx + x * R * k;
      proj.y = cy + y2 * R * k;
      proj.z = z2;
      proj.k = k;
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Advances the simulation by dt seconds and paints one frame. */
    const step = (dt: number, settle: boolean) => {
      const { state: s, level: ext } = input.current;
      t += dt;

      const target = ext === undefined ? synthLevel(s, t) : Math.min(1, Math.max(0, ext));
      lvl = settle ? target : lvl + (target - lvl) * 0.35;
      for (let i = 0; i < BINS; i++) bins[i] = lvl * (0.55 + 0.45 * Math.sin(i * 0.9 + t * 7 + Math.sin(t * 2 + i)));

      const tgt = SHAPES[s];
      const e = settle ? 1 : 1 - 0.02 ** dt;
      for (const k of Object.keys(tgt) as (keyof Shape)[]) cur[k] += (tgt[k] - cur[k]) * e;
      const glowTarget = s === "speaking" ? lvl : s === "listening" ? lvl * 0.4 : 0;
      glow = settle ? glowTarget : glow + (glowTarget - glow) * 0.15;

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.32;
      g.clearRect(0, 0, W, H);

      const grd = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      // A soft glow that fades to nothing, so the shoal sits in the page instead of on a disc.
      const onLight = lightScheme?.matches ?? false;
      grd.addColorStop(
        0,
        onLight ? `rgba(31,122,105,${0.05 + glow * 0.12})` : `rgba(242,215,155,${0.04 + glow * 0.2})`,
      );
      grd.addColorStop(
        0.5,
        onLight ? `rgba(31,122,105,${0.02 + glow * 0.04})` : `rgba(120,200,210,${0.03 + glow * 0.05})`,
      );
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);

      const tilt = cur.tilt * 0.5 + 0.12 * Math.sin(t * 0.21);
      const breathe = s === "listening" ? 1 + Math.sin(t * 1.6) * 0.015 : 1;

      for (let i = 0; i < n; i++) {
        const f = fish[i] as Fish;
        // Milling: fish near the equator swim faster, like a real bait ball.
        const eq = Math.cos(f.lat);
        f.lon += dt * f.speed * cur.swim * (0.6 + 0.6 * eq);
        f.lat = f.lat0 * cur.band + 0.07 * cur.wobble * Math.sin(t * f.wob + f.phase);

        const b = bins[(f.bin + Math.floor(t * 0.5)) % BINS] ?? 0;
        const rt = cur.radius * breathe * (1 + (s === "speaking" ? 0.42 : 0.18) * b * lvl * 1.6);
        if (settle) {
          f.r = rt;
          f.rv = 0;
        } else {
          f.rv += (rt - f.r) * 0.18;
          f.rv *= 0.72;
          f.r += f.rv;
        }

        const r = f.r;
        const cl = Math.cos(f.lat);
        project(r * cl * Math.cos(f.lon), -r * Math.sin(f.lat), r * cl * Math.sin(f.lon), cx, cy, R, tilt);
        const px = proj.x;
        const py = proj.y;
        const pz = proj.z;
        const pk = proj.k;
        // Heading from a point slightly ahead on the path.
        const l2 = f.lon + 0.04;
        const la2 = f.lat + 0.04 * 0.07 * cur.wobble * Math.cos(t * f.wob + f.phase);
        project(
          r * Math.cos(la2) * Math.cos(l2),
          -r * Math.sin(la2),
          r * Math.cos(la2) * Math.sin(l2),
          cx,
          cy,
          R,
          tilt,
        );
        const hx = proj.x - px;
        const hy = proj.y - py;
        const expected = 0.04 * r * Math.max(cl, 0.15) * R * pk;
        sx[i] = px;
        sy[i] = py;
        sa[i] = Math.atan2(hy, hx);
        sl[i] = Math.max(0.28, Math.min(1, Math.hypot(hx, hy) / (expected + 1e-6)));
        sk[i] = pk;
        depth[i] = pz;
      }
      order.sort((a, b) => (depth[a] ?? 0) - (depth[b] ?? 0));

      const base = Math.max(0.9, Math.min(W, H) / 300) * fishScale;
      for (const i of order) {
        const f = fish[i] as Fish;
        const d = ((depth[i] ?? 0) + 1) / 2;
        const glint = Math.max(0, Math.sin(f.lon * 2 + t * 0.7 + f.phase * 0.3)) ** 8;
        const light = Math.min(1, 0.15 + d * 0.7 + glint * 0.35 + glow * 0.15);
        const wag = Math.sin(t * (9 + cur.swim * 4) + f.phase) * 1.1;
        drawFish(
          g,
          sx[i] ?? 0,
          sy[i] ?? 0,
          sa[i] ?? 0,
          sl[i] ?? 1,
          base * f.size * (sk[i] ?? 1),
          light,
          0.25 + d * 0.75,
          f.hue + glint * 20 * glow,
          wag,
        );
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt, false);
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    /** Animates when allowed, otherwise paints one still frame of the current state. */
    const start = () => {
      stop();
      if (document.hidden) return;
      if (motion.matches) {
        step(0, true);
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    redraw.current = () => {
      if (motion.matches && !document.hidden) step(0, true);
    };

    resize();
    start();

    const observer = new ResizeObserver(() => {
      resize();
      if (motion.matches) step(0, true);
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", start);
    motion.addEventListener("change", start);

    return () => {
      stop();
      redraw.current = null;
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
      motion.removeEventListener("change", start);
    };
  }, [count, fishScale]);

  return (
    <div className={className ? `orb ${className}` : "orb"} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

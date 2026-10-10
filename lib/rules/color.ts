// YouCam 색조 분석의 피부·입술 색으로 파운데이션 셰이드(CIEDE2000)와 립·블러시를 고른다
import { PRODUCTS, getProduct, type Product } from "../catalog/products";
import type { LookSpec } from "../youcam/requests";

type Lab = { L: number; a: number; b: number };

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Bad hex ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function hexToLab(hex: string): Lab {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // sRGB D65
  const X = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const Y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const Z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIEDE2000 colour difference (Sharma et al. 2005 formulation). */
export function deltaE2000(x: Lab, y: Lab): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(x.a, x.b);
  const C2 = Math.hypot(y.a, y.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * x.a;
  const a2 = (1 + G) * y.a;
  const c1 = Math.hypot(a1, x.b);
  const c2 = Math.hypot(a2, y.b);
  const h = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1 = h(x.b, a1);
  const h2 = h(y.b, a2);
  const dL = y.L - x.L;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh * rad) / 2);
  const Lm = (x.L + y.L) / 2;
  const cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
    else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * cm;
  const Sh = 1 + 0.015 * cm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export type Undertone = "cool" | "neutral" | "warm";

/** Heuristic from the Lab hue angle of the skin colour: yellower = warm, pinker = cool. */
export function undertoneOf(hex: string): Undertone {
  const { a, b } = hexToLab(hex);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  if (hue >= 62) return "warm";
  if (hue <= 52) return "cool";
  return "neutral";
}

export interface ShadeMatch {
  productId: string;
  label: string;
  hex: string;
  deltaE: number;
  undertoneMatch: boolean;
}

export function matchFoundation(skinHex: string, top = 3): ShadeMatch[] {
  const skin = hexToLab(skinHex);
  const tone = undertoneOf(skinHex);
  return PRODUCTS.filter((p) => p.category === "foundation" && p.shade)
    .map((p) => {
      const dE = deltaE2000(skin, hexToLab(p.shade!.hex));
      const undertoneMatch = p.shade!.undertone === tone || p.shade!.undertone === "neutral";
      // A wrong undertone looks off even at a similar depth: small penalty.
      return { productId: p.id, label: p.shade!.label, hex: p.shade!.hex, deltaE: round2(dE), undertoneMatch, score: dE + (undertoneMatch ? 0 : 2.5) };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, top)
    .map(({ score: _s, ...m }) => m);
}

export interface LookSuggestion {
  everydayLip: ShadeMatch;
  statementLip: ShadeMatch;
  blush: ShadeMatch;
  undertone: Undertone;
}

export function suggestLook(skinHex: string, lipHex?: string): LookSuggestion {
  const tone = undertoneOf(skinHex);
  const skin = hexToLab(skinHex);
  const natural = hexToLab(lipHex ?? "#B5686A");
  const lips = PRODUCTS.filter((p) => p.category === "lip" && p.shade).map((p) => toMatch(p, natural));
  const everydayLip = [...lips].sort((a, b) => a.deltaE - b.deltaE)[0];
  const statementPref: Record<Undertone, string[]> = {
    warm: ["velin-lip-brick", "velin-lip-coral"],
    cool: ["velin-lip-berry", "velin-lip-plum"],
    neutral: ["velin-lip-rosewood", "velin-lip-berry"],
  };
  const statementLip =
    lips.find((l) => statementPref[tone].includes(l.productId) && l.productId !== everydayLip.productId) ?? lips[0];
  const blush = PRODUCTS.filter((p) => p.category === "blush" && p.shade)
    .map((p) => toMatch(p, skin))
    .sort((a, b) => Number(b.undertoneMatch) - Number(a.undertoneMatch) || a.deltaE - b.deltaE)[0];
  const blushFixed = { ...blush, undertoneMatch: getUndertone(blush.productId) === tone };
  return { everydayLip, statementLip, blush: blushFixed, undertone: tone };

  function toMatch(p: Product, ref: Lab): ShadeMatch {
    return {
      productId: p.id,
      label: p.shade!.label,
      hex: p.shade!.hex,
      deltaE: round2(deltaE2000(ref, hexToLab(p.shade!.hex))),
      undertoneMatch: p.shade!.undertone === tone || p.shade!.undertone === "neutral",
    };
  }
}

function getUndertone(id: string) {
  return PRODUCTS.find((p) => p.id === id)?.shade?.undertone;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** The Makeup VTO request for a planned look; shared by the app and the recording script. */
export function lookSpec(look: { foundation_id: string; blush_id: string }, lipId: string): LookSpec {
  const shade = (id: string) => getProduct(id)?.shade?.hex ?? "#A65E62";
  return {
    foundation: { hex: shade(look.foundation_id), coverage: 35, glow: 40 },
    lip: { hex: shade(lipId), texture: getProduct(lipId)?.texture ?? "satin", intensity: 55 },
    blush: { hex: shade(look.blush_id), intensity: 30 },
    skinSmooth: 15,
  };
}

// Perspective correction for angled photos of a mat. Four marked corners (top-left, top-right, bottom-right,
// bottom-left of the mat, in image pixels) are mapped onto a rectangle with a homography — the 3 × 3 projective
// transform a camera applies to a flat surface — and the image is resampled top-down.

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

// Solve the 8 unknowns of H (h33 = 1) that map each src point to its dst point. Gaussian elimination, partial pivot.
export function homography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  for (let k = 0; k < 4; k += 1) {
    const [x, y] = src[k], [u, v] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c += 1) {
    let p = c;
    for (let r = c + 1; r < 8; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error('The four corners do not form a usable quadrilateral (three are in a line, or two coincide).');
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k += 1) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

// A quadrilateral is usable if it is convex and listed clockwise on screen (TL → TR → BR → BL).
export function quadProblem(q: Quad): string | null {
  let sign = 0;
  for (let k = 0; k < 4; k += 1) {
    const a = q[k], b = q[(k + 1) % 4], c = q[(k + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return 'Three of the corners are in a line.';
    const s = Math.sign(cross);
    if (sign && s !== sign) return 'The corners cross over: mark them in order top-left, top-right, bottom-right, bottom-left.';
    sign = s;
  }
  if (sign < 0) return 'The corners go the wrong way round: mark them top-left, top-right, bottom-right, bottom-left.';
  return null;
}

// Resample a grey image so the marked quadrilateral fills an outW × outH image. Outside the photo counts as white.
export function warpGray(gray: Uint8ClampedArray | Uint8Array, sw: number, sh: number, corners: Quad, outW: number, outH: number): Uint8ClampedArray {
  const p = quadProblem(corners);
  if (p) throw new Error(p);
  // Map output pixel centres back into the photo (inverse homography: output → source).
  const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
  const out = new Uint8ClampedArray(outW * outH);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const [sx, sy] = applyH(h, x + 0.5, y + 0.5);
      const fx = sx - 0.5, fy = sy - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const g = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= sw || yy >= sh ? 255 : gray[yy * sw + xx]);
      out[y * outW + x] = g(x0, y0) * (1 - ax) * (1 - ay) + g(x0 + 1, y0) * ax * (1 - ay) + g(x0, y0 + 1) * (1 - ax) * ay + g(x0 + 1, y0 + 1) * ax * ay;
    }
  }
  return out;
}

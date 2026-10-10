import { ShapeUtils, Vector2 } from "three";
import { inspectMesh } from "./stl";
import type { MeshData } from "./types";

// Ear clipping on the dominant face plane handles concave n-gons; a fan does not.
export function parseOBJ(text: string, name = "model.obj"): MeshData {
  if (text.length > 100 * 1024 * 1024) throw new Error("This OBJ is over 100 MB. Simplify it before importing.");
  const positions: number[][] = [], out: number[] = [];
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const fail = (i: number, message: string): never => { throw new Error(`OBJ line ${i + 1}: ${message}`); };
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].replace(/#.*/, "").trim().split(/\s+/);
    if (fields[0] === "v") {
      const xyz = fields.slice(1, 4).map(Number);
      if (xyz.length !== 3 || xyz.some(n => !Number.isFinite(n))) fail(i, "invalid vertex coordinates.");
      positions.push(xyz);
    } else if (fields[0] === "f") {
      const ids = fields.slice(1).map(token => {
        const index = Number(token.split("/")[0]);
        if (!Number.isInteger(index) || !index) fail(i, "vertex indices must be nonzero integers.");
        const id = index > 0 ? index - 1 : positions.length + index;
        if (id < 0 || id >= positions.length) fail(i, "vertex index is outside the vertex list.");
        return id;
      });
      if (ids.length > 3 && ids[0] === ids.at(-1)) ids.pop();
      if (ids.length < 3 || new Set(ids).size !== ids.length) fail(i, "face must contain at least three distinct vertices.");
      let normal = [0, 0, 0];
      for (let j = 0; j < ids.length; j++) {
        const a = positions[ids[j]], b = positions[ids[(j + 1) % ids.length]];
        normal = normal.map((n, k) => n + (a[(k + 1) % 3] - b[(k + 1) % 3]) * (a[(k + 2) % 3] + b[(k + 2) % 3]));
      }
      const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
      if (Math.max(...normal.map(Math.abs)) < 1e-12) fail(i, "degenerate face.");
      const axes = [0, 1, 2].filter(a => a !== axis);
      const points = ids.map(id => new Vector2(positions[id][axes[0]], positions[id][axes[1]]));
      const tris = ShapeUtils.triangulateShape(points, []);
      if (tris.length !== ids.length - 2) fail(i, "face cannot be triangulated; check for self-intersections.");
      const area = (a: Vector2, b: Vector2, c: Vector2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      const winding = points.reduce((n, p, j) => n + p.x*points[(j+1)%points.length].y-p.y*points[(j+1)%points.length].x, 0);
      for (const t of tris) {
        if (area(points[t[0]], points[t[1]], points[t[2]]) * winding < 0) [t[1], t[2]] = [t[2], t[1]];
        for (const j of t) out.push(...positions[ids[j]]);
      }
      if (out.length > 9_000_000) fail(i, "simplify to fewer than one million triangles.");
    }
  }
  if (out.length < 36) throw new Error("The OBJ contains no usable 3D volume. Export mesh faces, not curves or points.");
  const vertices = new Float64Array(out);
  return { vertices, info: inspectMesh(vertices, name, "Wavefront OBJ") };
}

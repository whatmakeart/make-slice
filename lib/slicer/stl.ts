import type { MeshData, ModelInfo } from "./types";

export function meshBounds(v: ArrayLike<number>): { min: number[]; max: number[]; dimensions: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) throw new Error("The mesh contains invalid vertex coordinates.");
    const a = i % 3; min[a] = Math.min(min[a], v[i]); max[a] = Math.max(max[a], v[i]);
  }
  const dimensions = max.map((n, a) => n - min[a]) as [number, number, number];
  if (dimensions.some(n => n <= 1e-9 || !Number.isFinite(n))) throw new Error("The STL must have volume in all three dimensions.");
  return { min, max, dimensions };
}

export function inspectMesh(vertices: Float64Array, name: string, format: string): ModelInfo {
  const { min, dimensions } = meshBounds(vertices);
  const e = Math.max(...dimensions) * 1e-7;
  const vertexIds = new Map<string, number>(), edgeCounts = new Map<string, number>();
  const ids = new Uint32Array(vertices.length / 3);
  for (let i = 0, j = 0; i < vertices.length; i += 3, j++) {
    const key = [0, 1, 2].map(a => Math.round((vertices[i + a] - min[a]) / e)).join(",");
    let id = vertexIds.get(key);
    if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
    ids[j] = id;
  }
  for (let i = 0; i < ids.length; i += 3) {
    if (ids[i] === ids[i + 1] || ids[i + 1] === ids[i + 2] || ids[i] === ids[i + 2]) continue;
    for (let j = 0; j < 3; j++) {
      const a = ids[i + j], b = ids[i + (j + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const n of edgeCounts.values()) { if (n === 1) boundaryEdges++; if (n > 2) nonManifoldEdges++; }
  return { name, format, triangleCount: vertices.length / 9, originalDimensions: dimensions, boundaryEdges, nonManifoldEdges };
}

export function parseSTL(buffer: ArrayBuffer, name: string): MeshData {
  if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("This STL is over 100 MB. Simplify the mesh before importing it.");
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const expected = 84 + count * 50;
  const head = new TextDecoder().decode(buffer.slice(0, Math.min(256, buffer.byteLength))).trimStart();
  if(count>1_000_000&&expected<=buffer.byteLength)throw new Error("Simplify this mesh to fewer than one million triangles.");
  const binary = count > 0 && count <= 1_000_000 && (expected === buffer.byteLength || (expected <= buffer.byteLength && (!/^solid\b/i.test(head)||/[\x00-\x08\x0e-\x1f]/.test(head))));
  let vertices: Float64Array, format: string;
  if (binary) {
    vertices = new Float64Array(count * 9);
    for (let t = 0; t < count; t++) {
      const off = 84 + t * 50 + 12;
      for (let j = 0; j < 9; j++) vertices[t * 9 + j] = view.getFloat32(off + j * 4, true);
    }
    format = "Binary STL";
  } else {
    const text = new TextDecoder().decode(buffer);
    if (!/^\s*solid\b/i.test(text)) throw new Error("This is not a readable binary or ASCII STL file.");
    const number = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)";
    const re = new RegExp(`\\bvertex\\s+${number}\\s+${number}\\s+${number}`, "gi");
    const values: number[] = []; let match: RegExpExecArray | null;
    while ((match = re.exec(text))) { values.push(Number(match[1]), Number(match[2]), Number(match[3])); if (values.length > 9_000_000) throw new Error("Simplify this mesh to fewer than one million triangles."); }
    if (values.length < 36 || values.length % 9 !== 0) throw new Error("The ASCII STL contains incomplete triangles.");
    const facets = text.match(/\bfacet\s+normal\b/gi)?.length;
    if (facets !== values.length / 9) throw new Error("The ASCII STL facet and vertex counts do not match.");
    vertices = new Float64Array(values); format = "ASCII STL";
  }
  return { vertices, info: inspectMesh(vertices, name, format) };
}

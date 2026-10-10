"""Independent DXF/SVG fixture audit. Requires ezdxf; first run tests/plan.ts."""
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import ezdxf

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / ".sites-runtime/validation/sprint-32"
records = []
for path in sorted(FIXTURES.glob("*.dxf")):
    doc = ezdxf.readfile(path)
    audit = doc.audit()
    assert not audit.errors and not audit.fixes, (path.name, audit.errors, audit.fixes)
    legacy = doc.dxfversion == "AC1009"
    if not legacy:
        assert doc.header.get("$INSUNITS") == 4, path.name
    for layer, color in {"CUT_OUTLINE": 1, "CUT_INTERIOR": 3, "ETCH_LABELS": 5}.items():
        assert abs(doc.layers.get(layer).dxf.color) == color, (path.name, layer)
    outlines = opens = entities = 0
    cut_segments = set()
    all_points = []
    for entity in doc.modelspace():
        if entity.dxf.layer not in ("CUT_OUTLINE", "CUT_INTERIOR"):
            continue
        entities += 1
        kind = entity.dxftype()
        if kind == "LWPOLYLINE":
            points = [tuple(p[:2]) for p in entity.get_points()]
            closed = bool(entity.closed)
        elif kind == "POLYLINE":
            points = [(p.dxf.location.x, p.dxf.location.y) for p in entity.vertices]
            closed = bool(entity.is_closed)
        elif kind == "LINE":
            points = [(entity.dxf.start.x, entity.dxf.start.y), (entity.dxf.end.x, entity.dxf.end.y)]
            closed = False  # Explicit advanced segment-only compatibility file.
        else:
            raise AssertionError((path.name, kind))
        assert all(math.isfinite(v) for p in points for v in p), path.name
        if entity.dxf.layer == "CUT_OUTLINE" and kind != "LINE":
            assert closed and len(points) >= 3, path.name
            outlines += 1
        opens += int(not closed)
        all_points.extend(points)
        for a, b in zip(points, points[1:] + ([points[0]] if closed else [])):
            assert math.dist(a, b) > 1e-7, (path.name, "zero segment")
            segment = tuple(sorted((tuple(round(v, 5) for v in a), tuple(round(v, 5) for v in b))))
            assert segment not in cut_segments, (path.name, "duplicate cut", segment)
            cut_segments.add(segment)
    if "Kerf_Measurement" in path.name or "Joint_Fit_Test" in path.name:
        artwork = []
        for entity in doc.modelspace().query("LWPOLYLINE"):
            artwork.extend(tuple(p[:2]) for p in entity.get_points())
        width, height, _ = doc.header["$EXTMAX"]
        borders = [min(p[0] for p in artwork), min(p[1] for p in artwork), width - max(p[0] for p in artwork), height - max(p[1] for p in artwork)]
        assert all(abs(v - 20) < 0.0002 for v in borders), (path.name, "test artboard border", borders)
    if "LAYOUT_REFERENCE" in path.name:
        assert doc.layers.get("REFERENCE_GUIDES").dxf.color < 0, path.name
    else:
        assert not any(e.dxf.layer == "REFERENCE_GUIDES" for e in doc.modelspace()), path.name
    records.append({"file": path.name, "format": doc.dxfversion, "auditErrors": len(audit.errors), "auditFixes": len(audit.fixes), "units": "mm" if not legacy else "explicit mm import required", "cutEntities": entities, "closedOutlines": outlines, "intentionalOpenOrAdvancedLineEntities": opens, "duplicateCutSegments": 0, "boundsMm": [min(p[0] for p in all_points), min(p[1] for p in all_points), max(p[0] for p in all_points), max(p[1] for p in all_points)]})

ns = {"s": "http://www.w3.org/2000/svg"}
for path in sorted(FIXTURES.glob("*.svg")):
    if "Instructions" in path.name or "instructions" in path.name:
        continue
    root = ET.parse(path).getroot()
    assert root.attrib["width"].endswith("mm") and root.attrib["height"].endswith("mm")
    w, h = float(root.attrib["width"][:-2]), float(root.attrib["height"][:-2])
    assert [float(v) for v in root.attrib["viewBox"].split()] == [0, 0, w, h]
    assert not root.findall(".//s:text", ns), (path.name, "production labels depend on fonts")
    if "Kerf_Measurement" in path.name or "Joint_Fit_Test" in path.name:
        # Parse emitted vector coordinates, independent of the coupon layout.
        import re
        artwork = []
        for vector in root.findall(".//s:path", ns):
            values = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", vector.attrib["d"])]
            artwork.extend(zip(values[::2], values[1::2]))
        borders = [min(p[0] for p in artwork), min(p[1] for p in artwork), w - max(p[0] for p in artwork), h - max(p[1] for p in artwork)]
        assert all(abs(v - 20) < 0.0002 for v in borders), (path.name, "test artboard border", borders)
    counts = {}
    for layer in ("CUT_OUTLINE", "CUT_INTERIOR", "ETCH_LABELS", "REFERENCE_GUIDES"):
        group = root.find(f".//s:g[@id='{layer}']", ns)
        assert group is not None
        paths = group.findall(".//s:path", ns)
        counts[layer] = len(paths)
        if layer == "CUT_OUTLINE":
            assert all(p.attrib["d"].strip().endswith("Z") for p in paths), path.name
        if layer in ("CUT_OUTLINE", "CUT_INTERIOR"):
            assert group.attrib["stroke-width"] == "0.0003528"
        if layer == "ETCH_LABELS":
            assert group.attrib["stroke-width"] == "0.1763889"
    if "LAYOUT_REFERENCE" not in path.name:
        assert counts["REFERENCE_GUIDES"] == 0, path.name
    records.append({"file": path.name, "format": "SVG", "units": "mm", "viewBoxMm": [w, h], "fontFreeProductionLabels": True, "pathsByOperationLayer": counts})

report = {"version": "3.2.0", "scope": "Independent parser, structural/scale and calibration-artboard border checks; not native CAM application import or physical cutting.", "passed": True, "files": records}
(ROOT / "docs/export-audit-3.2.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"passed": True, "files": len(records), "dxf": sum(r["format"] != "SVG" for r in records), "svg": sum(r["format"] == "SVG" for r in records)}, indent=2))

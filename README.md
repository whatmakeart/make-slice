# MakeSlice - 3D Model to Laser-Cut Assembly Slicer

**MakeSlice** is a free, browser-based digital fabrication tool that turns 3D models (STL and OBJ) into physical slot-together, stacked, or folded sheet assemblies for laser cutters and CNC routers. All processing runs 100% locally in your browser-no file uploads, servers, or installations required.

<div align="center">
  <h1>make-slice</h1>
  <p>Slice, prepare, and process 3D models and geometry.</p>

  <!-- Live Demo / Web Link -->
  <a href="https://whatmakeart.com/make-slice/">
    <img src="https://img.shields.io/badge/🚀_Live_Demo-Try_Online-2ea44f?style=for-the-badge" alt="Live Demo">
  </a>
  <br/><br/>

  <!-- Status & Package Badges -->

# make-slice

[![License](https://img.shields.io/github/license/whatmakeart/make-slice?style=flat-square)](LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Vite](https://img.shields.io/badge/Vite-8-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/) [![Node](https://img.shields.io/badge/Node-%3E%3D22.15-brightgreen.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

---

## Quick Start Guide

1. **Launch MakeSlice**

- Double-click `index.html` to open MakeSlice directly in any modern desktop browser (Chrome, Firefox, Safari, Edge).
- It runs completely offline.

2. **Import or Select a 3D Model**

- Drag and drop an `.stl` or `.obj` file onto the window, or select one from the **Source model** dropdown (such as the included organic sample _Jimmy_ or geometric demo models).

3. **Set Model Dimensions**

- Under **Model & scale**, set your target dimensions ($X$, $Y$, or $Z$) and lock aspect ratios as needed.

4. **Choose a Construction Method**

- Select **Interlocking**, **Stacked**, or **Box / Shell** in the left sidebar.

5. **Configure Stock & Laser Parameters**

- Input your exact sheet dimensions, caliper-measured material thickness, and laser beam kerf.

6. **Preview & Inspect**

- Orbit the 3D assembly, drag the **Explode** slider to inspect joints, scrub through assembly sequence steps, and inspect the nested 2D cut sheets.

7. **Export the Cut Bundle**

- Click **Export cut bundle** to download a unified ZIP containing ready-to-cut DXF/SVG sheets, printable assembly manuals (PDF), 3D OBJ models, and CSV cut lists.

---

## Workspace Layout

The MakeSlice interface is organized as a dedicated CAD studio:

- **Top Navigation Bar:**
- Displays the active model name, overall bounding dimensions, part count, total sheet count, material yield efficiency, and cut readiness status.

- **Left Sidebar (Parameters Rail):**
- Houses all geometry, slicing, material, nesting, and export controls.
- Number fields commit on **Enter** or clicking away (**blur**). Sliders display live previews and regenerate on release.
- Undo/Redo is supported (**Ctrl/Cmd + Z** and **Ctrl/Cmd + Shift + Z** / **Ctrl + Y**).

- **Center Viewport:**
- Toggle between **3D Assembly**, **2D Sheets**, or **Split** view using the top buttons.
- In **Split** view, drag the central divider to adjust canvas ratios (double-click to reset).

- **Part Inspector:**
- Click any individual part in either the 3D or 2D view to inspect its ID, dimensions, assigned material slot, and highlight its matching slots and cut sheet location.

---

## Construction Methods

### 1. Interlocking (Waffle / Egg-Crate Grid)

Slices the model along orthogonal axes into cross-notched ribs that slot together at 90° angles.

- **Rib Count / Spacing:** Control the distribution and density of longitudinal and transverse ribs.
- **Notch Clearance:** Automatically sizes slots to your measured material thickness plus kerf compensation.

### 2. Stacked Slices

Slices the model into flat layers stacked along the $X$, $Y$, or $Z$ axis.

- **Alignment Pins:** Automatically generates blind or through alignment pin holes (round dowels or flat strip keys cut from your material).
- **Blind Caps:** Leaves top layers unperforated to hide alignment pins internally.

### 3. Box / Shell & Hollow Assemblies

Converts models into hollow shells, enclosures, or contoured sculptural structures.

- **Extruded Profiles:** Auto-detects constant cross-section extrusions (cylinders, hollow tubes, extruded lettering) and creates top/bottom caps, outer walls, and tunnel walls with interlocking finger joints.
- **Contour Bands (Living Hinges):** Slices complex or organic curved meshes into stepped horizontal bands wrapped with laser-cut living-hinge strips. Intermediate slotted plates anchor the strips together.
- **Faceted Panels:** Flattens beveled or changing surfaces into planar polygonal panels connected by finger joints or adhesive tabs (controlled via **Curve deviation**).
- **Internal Bracing:** Adds automatic longitudinal, transverse, or egg-crate grid cross-bracing inside hollow volumes, complete with weight-reduction cutouts.

---

## Materials, Kerf, and Nesting

### Material Slots (T1, T2, T3)

Configure up to three different material thicknesses or types in a single project (e.g., cardboard frame with acrylic accents or plywood reinforcement):

- **Thickness:** Measure your material with digital calipers (e.g., 3.8 mm cardboard, 3.1 mm acrylic). Do not rely on nominal dimensions.
- **Kerf:** Enter the width of material vaporized by your laser beam (typically 0.15 mm – 0.25 mm). MakeSlice expands outer contours and shrinks slots so joints press-fit snugly.
- **Hinge Calibration:** Set the effective neutral bend axis ($K$-factor) and custom lattice slit lengths for flexible living hinge strips.

### Scrap Inventory & Polygon Nesting

- **Rectangular Scraps:** Enter dimensions and quantities of leftover offcuts. MakeSlice nests parts into scraps first before allocating full stock sheets.
- **True-Shape Nesting:** Employs rasterized polygon nesting to pack small parts inside hollow apertures and concave curves.
- **Orientation Constraints:** Restrict rotation to 90° for grain-sensitive materials (like wood veneer or corrugated cardboard flutes) or 15° for maximum density.

---

## Fabrication & Laser Cutting Guide

### Line & Layer Color Standards

All exported SVG and DXF files follow standard fabrication layer conventions:

| Layer / Color | Operation | Stroke / Line Weight | Notes |
| --- | --- | --- | --- |
| **Blue** | Vector Etch / Score | `0.5 pt` / `0.18 mm` | Part numbers, alignment guides, blind joints. Run first. |
| **Green** | Interior Cut | `0.001 pt` / `0.00 mm` | Slots, dowel holes, hinge slits, tunnel walls. Cut second. |
| **Red** | Exterior Cut | `0.001 pt` / `0.00 mm` | Part perimeters. Cut last to prevent shifted pieces. |

> **Important CAM Note:** Disable additional kerf compensation in your laser software (LightBurn, LaserCAD, Glowforge, etc.). MakeSlice already applies exact kerf offsets to all generated paths.

---

## Export Bundle Contents

Clicking **Export cut bundle** downloads a ZIP archive containing:

- `[Project]_sheet_01.dxf / .svg`: Individual nested sheets formatted for laser cutting.
- `MASTER_ALL_SHEETS.dxf / .svg`: Complete nesting layout of all sheets side-by-side.
- `Assembly.obj`: 3D solid model showing physical part thicknesses, slot engagements, and bent hinges.
- `Assembly_Guide.pdf`: Step-by-step vector assembly manual (Letter or A4) with numbered isometric callouts, exploded diagrams, and Bill of Materials (BOM).
- `assembly.csv` & `sheets.csv`: Tabular part schedules, sheet counts, and cut lengths.
- `project-settings.json`: Machine defaults and project parameters for reproducibility.
- **Assembly Video:** Recorded progressive assembly animations (.mp4 / .webm) can be captured directly from the 3D sequence toolbar.

---

## Keyboard Shortcuts

- **Ctrl / Cmd + Z:** Undo parameter change (up to 25 steps).
- **Ctrl / Cmd + Shift + Z** or **Ctrl + Y:** Redo parameter change.
- **Enter:** Commit numeric input field.
- **Esc:** Close settings drawer (mobile/tablet) or dialog windows.
- **Space / Arrow Keys:** Step through 3D assembly playback sequence.

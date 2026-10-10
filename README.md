# MakeSlice 2.4.0 — advanced fabrication workspace

## Committed controls and dark CAD studio (2.4)

**Jimmy is the default example.** The supplied What Make Art mark sits beside the MakeSlice name and slotted tool icon, replaces the favicon, and appears in the exploded diagram and every printable SVG/PDF header. The slate theme extends through the header, settings, inspector, HUDs, menus and dialogs; paper and fabrication guides stay white.

- Sliders show draft values immediately and regenerate geometry on release. Number fields commit on **Enter** or **blur**. Clearing an input temporarily leaves the assembly alone; invalid values revert and out-of-range values clamp when committed. Camera, explode and sequence sliders remain immediate.
- Drag the divider in **Split** view to resize the canvases (20–80%). Arrow keys adjust a focused divider; Home/End reach the limits, and double-click restores the default. Existing resize observers refit the viewports. The ratio survives view-mode changes within the session.
- **Undo/redo** stores up to 25 committed parameter changes. Use the toolbar arrows, **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z**, or **Ctrl+Y**. Native text undo stays available while editing a field. Loading a different mesh resets parameter history.
- Bed dimensions, primary thickness, kerf and slot clearance are saved under `makeslice_machine_defaults` on export or when the touch settings drawer closes, then restored at startup. Model files, geometry and project settings are not cached. Invalid or inaccessible browser storage falls back safely. Reset settings explicitly returns the 900 × 600 mm factory defaults. Browser preference access can vary for file:// pages.
- A loaded assembly requests the browser's standard tab-close warning. Browsers control whether they show it, usually after a user interaction. WebGL pixel ratio is capped at 2.

This release adds no dependencies, processing workers, backend, service worker, or caching framework. The established slicer client and inline-worker/compatibility fallback are retained.

## Canvas workspace and contour bands (2.3)

The default stock sheet is **900 × 600 mm**. Machine power and travel speed are configured in your laser software; MakeSlice has no speed control. Measure thickness and kerf for each material slot.

The 52 px MakeSlice header combines the model, dimensions, parts/sheets/yield and fabrication status. The app never scrolls as a document. Settings scroll inside the 320 px rail; the Export cut bundle action stays at its base. Model & scale and Slicing structure open initially. Material & tooling and Advanced / production are collapsed. Choose **3D Assembly**, **2D Sheets**, or **Split** above the canvases. Click a part to open its inspector, select its stock, and see matching joints/sheet. Open **Sequence** for playback and video capture, including the independent reference ghost toggle. Individual sheet and all assembly/master exports are retained. Below 1050 px, only one canvas is active and **Tune settings** opens a focus-trapped drawer; Escape or the backdrop closes it.

For an organic hollow shell, choose **Box → Living hinge strips** with **Auto** or **Contour bands**. Constant extrusions keep continuous profile wall strips. Changing profiles are sliced into stepped hollow bands around centerline cross-sections. **Maximum band height** controls the starting intervals; **Adaptive band heights** subdivides where boundary displacement or hole/island topology changes. **Band profile deviation** is the sampled boundary change target, distinct from in-plane Curve deviation. Band height is independent of measured stock thickness. Minimum height leaves space for both plates and a hinge web. Profiles that change faster than this stock can accommodate are reported as notes, rather than claiming the requested error is met.

Each intermediate **PLATE** follows the union of the neighboring profiles and contains slots for both bands. Lower and upper tabs enter opposite halves of that shared plate, with a small depth gap; secure these through-slots and strip butt seams with adhesive. Disjoint plate islands receive individual labels but share a stock assignment. Through-holes receive inner bands and retain open cap apertures. Numbered B/PLATE parts, strip cuts, actual stock extrusions, stepped assembly, band-aware exploded groups and printed sequence pages use the same part definitions. Assembly illustrations omit tiny lattice channels for readability; full lattice cuts stay in the flat guide inventory, cut sheets, viewport and OBJ. Existing facets, solid stacks, interlocking ribs and extrusion braces remain available.

Contour bands are a fabrication approximation: a compound curved mesh cannot become one flat, unstrained strip. Shorter bands follow it more closely but use more plates. Compare the ghost mesh and test a hinge/joint coupon before production. Effective K, thickness and optional lattice pitch/slit length remain independent per material slot. Acrylic hinges still require explicit tested-stock opt-in. Contour plates provide band reinforcement; extrusion grid braces are not inserted into bands.

Open the prebuilt **slice-lab/index.html** in a current desktop browser. It is a self-contained, offline page; no installation or web server is required. A split-asset version is also included in **slice-lab/dist/** for VS Code Live Server or static hosting such as GitHub Pages. Files and geometry stay in your browser.

## New fabrication features

- **STL + OBJ ingestion:** binary/ASCII STL and Wavefront OBJ, including concave n-gons, slash-delimited face references and negative vertex indices. Mesh topology and scale are checked.
- **Finger-joint boxes with holes:** extrusion-axis detection (including oblique meshes), top/bottom caps retaining enclosed holes, outer and inner tunnel walls, mating tabs/notches, square-corner fingers, relief and facet or living-hinge construction. Changing and beveled surfaces use contour bands with living hinges, or a separate flat-panel shell with facets. Try **Letter T shell**, **Letter S shell**, or the supplied **Donut box**. **Jimmy** is the supplied 42,516-triangle organic model, bundled for offline use. Choosing Jimmy starts with interlocking ribs; choose Box → Living hinge strips for contour bands, or increase Curve deviation for faceted panels.
- **Internal bracing:** automatic span support, transverse/longitudinal/grid placement, corner relief, cap/wall anchors, egg-crate half-lap slots, weight-reduction holes and an X-ray bracing view.
- **Three material slots:** cardboard, plywood, acrylic or custom material; measured thickness, kerf, name, display color and effective hinge K factor and optional independent hinge pitch/slit pattern for T1/T2/T3. Select a part in either view and apply the active slot, or enable Assign thickness on click. The model, mating slots and sheets regenerate together. Components belonging to one rib/layer cutting plane share its stock; cut-material alignment pins use T1. Acrylic hinges default off and can be explicitly enabled for tested stock.
- **Scrap inventory:** finite quantities of rectangular scraps with their own dimensions and stock IDs. Matching scraps pack first with conservative polygon raster nesting; standard stock fills the shortfall. No sheet mixes thickness slots.
- **Polygon nesting:** actual kerf-compensated boundaries, concave pocket and part-in-hole packing, and optional 90° or 15° orientation trials. Half-clearance polygon offsets plus conservative occupied cells preserve spacing and bed margins. Calculations run in the inline worker and report progress. Grid resolution starts at 0.75 mm and scales with very large sheets; narrow gaps may remain unused. The deterministic bottom-left heuristic is not a global optimum. Bounding-box MaxRects remains available for comparison. Scraps and sheets never mix thickness slots.
- **Blind pins:** round dowels or flat pins cut from T1, with an adjustable number of unperforated top layers. Pin locations are checked against only the layers they actually penetrate; flat pins stop below the crown.
- **Production CAD:** red CUT_OUTLINE, green CUT_INTERIOR, blue ETCH_LABELS. SVG cuts use 0.001 pt strokes; etches use 0.5 pt. DXF uses ACI 1/3/5 and 0.00/0.18 mm lineweights. Vector labels need no fonts. Default AutoCAD 2000 output uses closed, joined LWPOLYLINE contours; SVG contours use closed paths. Edge-open slots/notches stay within the red perimeter so it remains one contour, while enclosed holes/slots are green. Intentional hinge slits and etch strokes remain open. Optional LINE output and legacy R12 are available for importer compatibility.
- **Master layouts:** all sheet sizes arranged with 50 mm gaps in MASTER_ALL_SHEETS.dxf/svg, alongside individual sheet files. Blue sheet borders are planning guides; turn them off before cutting.
- **Assembly OBJ:** actual extruded solids with holes, slots, variable thickness, brace joints and bent living-hinge strips. Export uses assembled positions regardless of the exploded preview.
- **Assembly video:** Download video beside the assembly player, or Record assembly video in the export area, captures a slow camera orbit and progressive assembly from the WebGL canvas. A supported MP4 recorder is preferred; otherwise the file is WebM. The player has a separate **Show Reference Ghost Mesh in Video** switch (default on), independent of the preview ghost switch. Recordings include the original wireframe only when selected. Cancel restores the preview and releases the capture tracks.
- **Exploded manual:** an actual isometric assembly spread along its fitting axes with dashed guides and numbered callouts, followed by the retained individual labeled parts inventory and BOM. Dense curved shells keep surface facets in assembly groups in the first view; every individual panel is still numbered in the inventory. White faces hide rear edges, and the drawing grows vertically to preserve gaps. The BOM includes material family, stock, dimensions, sheets and brace anchors.
- **Printable guide:** keep the original large diagram, plus a paginated vector PDF and individual SVG pages on Letter or A4. The first page shows the exploded assembly and material summary; subsequent pages show highlighted assembly stages and grouped individual inventories with stock, quantity, cut dimensions, sheet references and joint markers. The PDF embeds subset DejaVu Sans fonts; its font license is included in assets/fonts/LICENSE.txt. Print guides at 100%; drawings are schematic, not cut templates.
- **Export naming:** project name defaults to the model name. Optional prefix/suffix, sheet-label toggle and Letter/A4 selection apply to batch and individual downloads. Sheet numbers remain unique, invalid filesystem characters are replaced, reserved device names are handled, and long filenames are limited. Project metadata is bundled.
- **UI clarity:** primary T1 stock is identified separately from the three-slot material library; hinge calibration lives beside its stock; a construction readout identifies extrusion/surface-panel shells and inner walls. Nonblocking fabrication notes explicitly say the download is ready. Mobile controls and the player-area video button remain available.

## Export bundle

Download all sheets · ZIP contains:

- [project]_sheet_01.dxf/svg, [project]_sheet_02.dxf/svg, etc.
- MASTER_ALL_SHEETS.dxf/svg
- Assembly.obj
- Assembly_Diagram.svg
- Assembly_Guide.pdf and assembly-guide/Assembly_Guide_Page_01.svg, etc.
- assembly.csv and sheets.csv
- project-settings.json, project-metadata.json and README.txt

The project prefix/suffix applies to each filename. For example, Jimmy_sheet_01.dxf and Jimmy_Assembly_Guide.pdf. Sheet suffix off removes the word sheet while retaining its unique number.

The export panel retains the earlier DXF-with-errors workflow: generated parts can be exported to CAD even if fabrication checks fail. Oversized parts have a separate Unplaced DXF at full scale. SVG and the laser ZIP require resolved fabrication errors. A hole that disappears because it is smaller than the kerf produces a warning and no longer blocks the laser ZIP or SVG downloads. The affected part IDs stay in the fabrication notes and bundled guide. A pending regeneration or failed import blocks stale downloads.

## Fabrication scope

Box mode auto-detects **constant closed extrusions along X, Y, Z, or an oblique mesh direction**, including T/S letterforms, cylinders and hollow outlines. Caps keep all profile holes, and each hole has its own tunnel walls. The imported world orientation is preserved. Select a specific axis or **Extruded profiles only** to constrain the method.

**Auto shell construction** uses contour bands for changing profiles when Living hinge strips is selected. With Flat facets selected, it develops a watertight changing-profile mesh into planar surface panels, including tunnel surfaces. Curve deviation accepts 0.05–15 mm. Higher values trade detail for fewer panels; extrusion caps use the same simplified profile as their faceted walls. Simplification preserves winding, checks the original contour points, and rejects crossings through other edges or holes. Dense meshes undergo topology-preserving quadric reduction with supporting-plane deviation constraints, then local surface projections controlled by Curve deviation. This is a faceted approximation, not exact unrolling of double curvature. Beveled models can create hundreds of small panels; increase Curve deviation for fewer parts or use ribs / stacked mode for simpler fabrication. Square, exact seams receive reciprocal fingers when they leave a connected panel; angled seams and fragile short joins need manual bevels, hand fitting or adhesive. Small fragments below 2 mm² can be omitted and are reported in the notes. Up to 750 surface regions are supported. Automatic extrusion bracing and living-hinge strips are not applied to compound surface panels.

Square wall corners receive complementary finger joints. Other faceted angles require a bevel or adhesive. Living-hinge strips bend along the intended perimeter and split at sheet-length limits; butt seams need adhesive. Each assigned stock's actual thickness controls the extrusion, cap joints, slots, and developed length. Effective K defaults to 0.5 (the geometric mid-surface). Relative to that path, length changes by **(K − 0.5) × thickness × total absolute bend angle**; the target 3D profile stays fixed. Global hinge pitch/slit length can be overridden per stock so each thickness/material can use its tested lattice. This is a calibration control, not a universal sheet-metal constant or a mechanical lattice model. Test each material, thickness, grain direction and slit pattern. Plywood grain/veneer layers affect flexibility; acrylic patterns suit tested static bends and can break with repeated flexing. No family presets assume a measured kerf, bend strength or safe radius.

Blind brace contacts produce blue alignment marks and unperforated butt joints for adhesive. Laser vector paths cannot specify a controlled-depth recess. Selecting a depth fraction below 1 uses these blind contacts rather than exporting a fictitious half-depth hole.

Measure actual thickness and kerf, verify the model dimensions and cut a fit sample. Disable additional CAM kerf offsets: the output paths are already compensated. Etch blue first. Usually cut green interiors before red perimeters; for part-in-hole nests, finish enclosed pieces before releasing their surrounding apertures in CAM. The physical laser settings determine beam width/power; **0.001 pt = 0.0003528 mm**, not 0.025 mm. R12 requires setting units and lineweights during import.

The assembly sequence identifies parts and order; it does not calculate collision-free insertion motions. The schematic is an assembly document, not a cut file. Mixed-stock master files are for planning; cut each sheet from the correct stock listed in the BOM.

## Edit and rebuild

With Node.js 22.15+ installed, run these commands in **slice-lab/source/**:

    npm ci
    npm run dev

Then edit components/slice-workspace.tsx, components/assembly-viewport.tsx, components/sheet-viewer.tsx, app/globals.css and lib/slicer/.

    npm run check
    npm run build
    npm test

The build writes source/dist/index.html as an offline standalone page, plus app.js and app.css. Run **npm run package** to rebuild and refresh the outer index.html, complete dist/, README and source ZIP in one command. The build refreshes embedded model/logo bytes from assets/ using scripts/embed-assets.mjs; update those assets and rebuild to replace the bundled examples or logo. The worker is compiled inline and waits for a startup handshake; a browser that blocks workers uses local compatibility processing.

Optional native browser verification:

    npx playwright install chromium
    npm run test:browser
    npm run test:enhancements

Run npm test first to create the geometry fixtures. CHROMIUM_EXECUTABLE can select an installed Chromium binary. The native check writes screenshots and a recorded video under source/.sites-runtime/validation/.

## Validation

Type checking, the production build and all automated regression checks pass for **2.4**. New interaction checks cover Jimmy startup, draft number entry, Enter/blur commits, a real slider drag/release, bounded parameter undo/redo and text-input shortcut guards, saved machine settings on export/drawer close and restoration on reload, splitter pointer/keyboard clamps, tab-close warning and listener cleanup. The final compiled standalone page loads Jimmy, imports an STL, and exports SVG/ZIP with both its inline worker and blocked-worker compatibility processing. The file:// test also exercises unavailable localStorage.

The branded Jimmy guide was rendered and reviewed (all 7 Letter pages have one shared embedded logo), including the overview and illustrated inventory. The donut A4 overview and Jimmy master diagram/header were also rendered and inspected. SVG pages embed the original PNG; PDFs share a 300 px JPEG while keeping parts, text and diagrams vector-based. Primary-action text and muted helper text meet AA contrast on the slate surfaces.

Existing checks cover adaptive/uniform bands, mixed-stock opposing tabs and physical plate/strip clearance, all stack axes, clear tunnels, manifold OBJ solids, joined CAD contours, band-aware exploded views, print guides, view switching, selection drawers, and the 375 px settings lifecycle. Live browser layout, WebGL shaders and video capture were not rerun for the 2.4 UI in this session; the native browser scripts are updated for local verification. Physical laser-cut joints remain untested.

Earlier 2.2 validation: New checks verify an L-shaped concave pocket reduces two bounding-box sheets to one polygon sheet, curved part-in-hole layouts, complementary rotated triangles, 15° narrow-bed fits, exact offset-polygon spacing, mixed scraps, worker progress, 10/15 mm curves, both embedded STL examples, safe names, and complete paginated Letter/A4 guides. A 50,304-triangle / 40-part benchmark completes slicing and polygon nesting in about 1.3 seconds in this environment. Regression checks cover STL, reciprocal half-laps, all pin axes, material pin stops, kerf, nesting, DXF/SVG/ZIP, UI behavior and worker failures. Added checks cover concave/negative-index OBJ, cross-thickness slot widths, physical stack depth, finite scraps, variable-sheet masters, blind pins, cube/T/S shells, braces, hinges and closed assembly OBJ round-trips. Sample 3D cross-sections verify that caps, walls and brace solids do not overlap at mating joints.

All five supplied STL fixtures are tested for successful shell generation, clear tunnel-center rays, identified inner surfaces, closed joined CAD contours, manifold solids per OBJ object, complete export bundles, and numbered assembly / inventory views. Tests also cover oblique extrusion frames, identical non-hinge geometry across material families, explicit acrylic opt-in, K-factor length changes at different assigned thicknesses, and preservation of the intended 3D bend profile. Independently fitted pieces may touch; assembly OBJ objects remain separate manufactured solids rather than a single Boolean union.

DXFs pass an independent ezdxf audit with the intended layers/colors/weights. The compiled file:// page works with its inline worker and with workers blocked. The 2.2 native Chromium session verified WebGL, mesh import, material assignment, X-ray, scrap controls, mobile layout and an actual H.264 MP4 assembly download. The schematic spacing is verified for all three construction modes and the resulting SVGs were rendered and visually inspected. The 2.2 native tests also verified the vanished-hole warning allows ZIP download and that the video button stays visible beside the player on mobile. Illustrator itself and physical laser-cut joints were not available for direct testing.

## Branding and implementation references

Header and footer link to [What Make Art](https://whatmakeart.com); the footer links to the [laser-slicer repository](https://github.com/whatmakeart/laser-slicer). URLs and version are centralized in lib/app-config.ts. The dedicated notched cross-lap tool mark is an inline SVG. The supplied What Make Art logo is the app link and PNG favicon, and is embedded in assembly documentation. Both logo assets and STL models are kept in assets/. Everything needed for the default examples is embedded in the standalone page.

The nesting implementation is original conservative raster bottom-left fill, using Clipper polygon offsets. It follows polygon nesting principles described by [SVGNest](https://github.com/Jack000/SVGnest), rather than integrating that library or promising its genetic/NFP optimizer. Acrylic rendering uses [Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html).

# Spine Inspector & Painter --- Five-Phase Test Plan

**Document type:** Product and engineering test specification\
**Project:** Spine Inspector & Painter\
**Primary stack:** React, TypeScript, PixiJS\
**Initial runtime target:** Spine **3.8.x** JSON + 3.8-format atlas
or binary `.skel` + 3.8-format atlas (see "Spine 3.8 Baseline"); 4.x
is detected and reported as unsupported until explicitly added\
**Status:** Proposed\
**Purpose:** Define five incremental phases for building, validating,
and expanding a Spine inspection and editing tool.

------------------------------------------------------------------------

## Product Goals

Spine Inspector & Painter is a developer-oriented tool for inspecting
Spine projects, debugging runtime behavior, reviewing animation changes,
and creating or editing selected visual elements.

The project should be developed incrementally. Each phase must produce a
usable artifact and a repeatable test suite before the next phase
begins.

### Global acceptance principles

-   A test must be repeatable with a known sample project and documented
    expected results.
-   The tool must clearly distinguish **source data**, **preview
    state**, and **runtime state**.
-   Unsupported Spine versions or data features must be reported
    clearly; the tool must not silently interpret them as supported.
-   Editing operations must not modify the original input files unless
    the user explicitly exports or saves a new version.
-   Import errors should identify the file and, when possible, the
    relevant field or asset.
-   The tool must remain responsive for ordinary game assets and provide
    a clear failure or performance warning for unusually large projects.
-   Each phase should include automated tests where practical and manual
    acceptance tests for visual behavior.

## Spine 3.8 Baseline

The first supported version is Spine 3.8. Spine runtimes only load data
from the same major.minor editor version, so every rule below is pinned
to 3.8 and must be revisited before adding 4.x.

**Runtime pinning**

-   Use a Spine 3.8 runtime, never a 4.x one. Current official npm
    packages (`@esotericsoftware/spine-*`) and `spine-pixi` target
    4.x only. Practical PixiJS route: `pixi-spine` 4.x with the
    `@pixi-spine/*-3.8` packages on PixiJS v7 (or `pixi-spine` 3.x on
    PixiJS v6). PixiJS v8 has no 3.8 runtime. Verify peer dependencies
    when pinning and record exact versions in the compatibility matrix.
-   Cocos Creator: confirm the bundled Spine runtime version per Creator
    release (2.4.x and most 3.x releases ship 3.8; verify before
    claiming support).

**Version gate (runs before the runtime parser)**

-   JSON: read `skeleton.spine`. Binary: read the version from the file
    header (3.x writes the hash then the version as strings; 4.x writes
    an 8-byte hash then the version, so 4.x binaries are still named
    correctly). Accept only `3.8.*`; anything else is reported with the
    detected version.
-   Reason: the 3.8 runtime does not reject older/newer data reliably.
    Example: 3.7 JSON stores `skins` as an object; the 3.8 parser
    iterates it as an array and silently loads **zero skins**. The gate
    must catch this rather than relying on runtime exceptions.
-   Binary `.skel` (common in Cocos projects) is supported through the
    runtime's `SkeletonBinary`. Binaries from editor 3.8.75 are rejected
    with a re-export message; that export is not readable by the 3.8
    runtime.
-   Phase 3 edits of a binary project are exported as 3.8 JSON (which
    Spine Editor 3.8 imports); the tool does not write binary.

**3.8 data shapes the tool must handle**

-   `skins` is an array of `{ name, attachments, bones, ik, transform,
    path }` (skin bones/constraints are new in 3.8).
-   Curves use `curve` (number or `"stepped"`) plus `c2`, `c3`, `c4`;
    rotate keys use `angle`; translate/scale/shear keys carry `x` and
    `y` in one timeline.
-   Deform timelines live under `animations.<name>.deform.<skin>.<slot>.<attachment>`.
-   Slot `color` is `RRGGBBAA`; `dark` (two-color tint) is `RRGGBB`.
-   Bone `transform`: `normal`, `onlyTranslation`,
    `noRotationOrReflection`, `noScale`, `noScaleOrReflection`.
-   Attachment types: `region`, `mesh`, `linkedmesh`, `boundingbox`,
    `path`, `point`, `clipping`. Attachment `path` overrides the atlas
    region name.
-   Events may carry `int`, `float`, `string`, and 3.8 audio fields
    (`audio`, `volume`, `balance`).
-   IK constraints include 3.8 `softness`, `compress`, `stretch`,
    `uniform`.

**3.8 atlas specifics**

-   Old text format: `size`, `format`, `filter`, `repeat` per page;
    `rotate`, `xy`, `size`, `orig`, `offset`, `index` per region.
-   `rotate: true` means 90°; `orig`/`offset` describe whitespace
    stripping. Both affect UVs and region display.
-   Multi-page atlases must work.
-   The 3.8 atlas has **no `pma` flag**. Premultiplied alpha must be a
    user/fixture setting; a wrong setting shows dark or bright fringes.

**Nonessential data**

-   3.8 export option "Nonessential data" controls `fps`, `images`,
    `audio`, bone/slot/bbox colors, and mesh `edges`/`width`/`height`.
    Features that depend on it (frame step size, mesh edge overlay,
    debug colors) must fall back gracefully and say so. Fixtures record
    whether it was enabled.

**Coordinate conventions**

-   Spine world space is y-up; Pixi screen space is y-down.
    Inspector values are shown in Spine units/space (degrees, y-up) and
    labeled as such; canvas coordinates are never shown as Spine data.
-   Setup pose (source data) and current pose (runtime state) are shown
    separately for Bones and Slots.

## Suggested Test Fixtures

Create and keep a small fixture library in the repository:

1.  `basic-character/` --- a simple skeleton with a root, body, head,
    arms, and a few slots.
2.  `multi-animation/` --- idle, walk, attack, and death animations with
    different durations.
3.  `multi-skin/` --- at least two skins with different attachments.
4.  `mesh-deform/` --- a mesh attachment with weighted vertices and a
    deform animation.
5.  `events/` --- an animation containing named events at known
    timestamps.
6.  `missing-assets/` --- JSON that references a missing atlas region or
    texture.
7.  `large-project/` --- a representative production-sized project for
    performance checks.
8.  `bbox-sample/` --- a project with known polygon bounding boxes and
    vertices.
9.  `version-mismatch/` --- the same small skeleton exported as 3.7 and
    4.0+, each as JSON and binary `.skel`, for the version gate.
10. `pma/` --- one 3.8 export with premultiplied alpha and one without.
11. `atlas-edge-cases/` --- multi-page atlas, rotated regions, stripped
    whitespace, and an attachment using `path` to a different region.
12. `constraints-clipping/` --- IK (with softness/stretch), transform and
    path constraints, a clipping attachment, two-color tint, and a skin
    with skin-specific bones.

Official 3.8 example exports can seed several fixtures (from the
`3.8` branch of `spine-runtimes`): spineboy (events, IK, bboxes),
goblins / mix-and-match (skins), raptor (weighted mesh, deform, IK),
tank (clipping), vine/stretchyman (path, constraints).

Record for each fixture: Spine editor export version (e.g. `3.8.99`),
JSON or binary, nonessential data on/off, PMA on/off, atlas page
sizes, runtime package versions, and expected behavior.

------------------------------------------------------------------------

# Phase 1 --- Spine Inspector MVP

## Objective

Build a browser-based inspector that can load a Spine JSON project and
its atlas assets, render a skeleton, browse its hierarchy, inspect Bone
and Slot properties, and play or seek animations.

The first phase is an inspection-only product. It must not edit or
overwrite source assets.

## Scope

-   Import Spine JSON and atlas/texture assets.
-   Render the skeleton in a PixiJS preview canvas.
-   Display a Skeleton Tree containing Bones, Slots, and Attachments.
-   Select a Bone, Slot, or Attachment from the tree or canvas.
-   Display basic properties for the selected item.
-   Play, pause, restart, and seek an animation.
-   Support zoom, pan, fit-to-view, and reset-view controls.
-   Display import errors and unsupported features.

## Test Cases

### P1-01 --- Import a valid Spine JSON project

**Setup:** Use `basic-character/` with its JSON, atlas, and texture
files.

**Steps:**

1. Open the tool.
2. Import the JSON file.
3. Provide or select the matching atlas and texture.
4. Wait for loading and rendering to complete.

**Expected results:**

- The project loads without an error.
- The skeleton appears in the preview canvas.
- The Skeleton Tree contains the expected Bone and Slot hierarchy.
- The tool identifies the project or skeleton name when available.
- The original input files remain unchanged.

### P1-02 --- Handle a missing atlas or texture

**Setup:** Use `missing-assets/`.

**Steps:**

1. Import the fixture.
2. Observe the error message and project state.

**Expected results:**

- The tool reports the missing file or region.
- The error is not swallowed or replaced by a generic blank preview.
- The UI remains usable so the user can retry with corrected assets or remove the failed project.

### P1-03 --- Browse the Skeleton Tree

**Steps:**

1. Expand and collapse Bone branches.
2. Select several Bones, Slots, and Attachments.
3. Switch between tree selection and canvas selection.

**Expected results:**

- Tree labels and hierarchy match the imported data.
- Selecting an item updates the Inspector panel.
- Selecting an item on the canvas highlights the corresponding tree row.
- Selection remains stable when unrelated branches are expanded or collapsed.

### P1-04 --- Inspect Bone properties

**Steps:**

1. Select a Bone.
2. Inspect available transform properties.
3. Select another Bone.

**Expected results:**

- The panel displays 3.8 Bone fields: `x`, `y`, `rotation`, `scaleX`, `scaleY`, `shearX`, `shearY`, `length`, `transform` mode, and parent.
- Setup-pose values and current-pose values (local and world) are shown separately and labeled.
- Values are labeled with their coordinate space and units where applicable.
- Missing or runtime-only values are not fabricated.
- Selecting another Bone refreshes the panel without stale values.

### P1-05 --- Inspect Slot and Attachment properties

**Steps:**

1. Select a Slot.
2. Inspect its current attachment and available metadata.
3. Select an Attachment.

**Expected results:**

- The Inspector displays the selected Slot and its current attachment when available.
- Attachment metadata is associated with the correct Slot.
- The UI distinguishes a Slot from an Attachment.
- Empty Slots are represented clearly rather than treated as import failures.
- Slot shows bone, setup `attachment`, `color`, `dark` (two-color tint) when present, and `blend` mode (`normal`, `additive`, `multiply`, `screen`).
- Attachments are listed per skin and identified by the triple skin + slot + attachment name (names are not globally unique in 3.8).
- Attachment type is shown; for region/mesh, the resolved atlas region (after `path` override) is shown.

### P1-06 --- Animation playback controls

**Setup:** Use `multi-animation/`.

**Steps:**

1. Select an animation.
2. Play it.
3. Pause it.
4. Restart it.
5. Seek to the beginning, middle, and end.

**Expected results:**

- Playback follows the animation duration.
- Pause freezes the preview at the current time.
- Restart returns to the start.
- Seeking updates the rendered pose.
- The displayed time and progress indicator stay synchronized.

### P1-07 --- Viewport controls

**Steps:**

1. Zoom in and out.
2. Pan around the skeleton.
3. Fit the skeleton to the canvas.
4. Reset the viewport.

**Expected results:**

- Zoom and pan do not alter skeleton data.
- Fit-to-view shows the whole visible skeleton with reasonable padding, using runtime bounds of the current pose (skeleton `width`/`height` are nonessential in 3.8 and may be absent).
- Reset restores the documented default view.
- Viewport controls remain usable during playback.

### P1-08 --- Unsupported data and version handling

**Setup:** Use `version-mismatch/` (3.7 and 4.x, JSON and `.skel`)
and a 3.8 fixture containing a feature the tool does not yet support.

**Expected results:**

- The tool displays a clear compatibility warning naming the detected version (`skeleton.spine` for JSON, header for binary).
- Wrong major.minor versions are **blocked**, not loaded in limited mode: the 3.8 runtime can misparse them silently (3.7 JSON loads with zero skins).
- The 3.7 fixture is rejected by the version gate, not by a downstream render symptom.
- A binary named `.json`, or an unreadable `.skel`, gets a clear message rather than a parse exception.
- A 3.8 `.skel` and the JSON export of the same project load identical bones, slots, skins, animations, and events.
- For a valid 3.8 file with an unsupported feature, the user can cancel or continue in a clearly limited mode, and the affected feature is named.
- Unsupported fields or features are not silently presented as correctly rendered.

### P1-09 --- Premultiplied alpha and atlas edge cases

**Setup:** Use `pma/` and `atlas-edge-cases/`.

**Steps:**

1. Import the PMA fixture with the PMA setting off, then on.
2. Import the non-PMA fixture with the setting off.
3. Import the multi-page, rotated, and whitespace-stripped atlas.

**Expected results:**

- The PMA setting is visible and per project (3.8 atlases carry no `pma` flag).
- With the correct setting, edges render without dark/bright fringes; the wrong setting is visibly wrong, documented as expected.
- Rotated and stripped regions render in the correct position and orientation.
- Regions on every atlas page load; a missing page names the page file.

## Phase 1 Exit Criteria

-   All critical import, hierarchy, selection, playback, and viewport
    tests pass.
-   A user can inspect a valid sample project without opening the Spine
    Editor.
-   The tool does not write to source files.
-   Import failures are actionable and do not crash the application.

------------------------------------------------------------------------

# Phase 2 --- Spine Runtime Debug Tools

## Objective

Add visual and runtime-oriented debugging features that help developers
understand the actual skeleton state during animation playback or inside
a supported game runtime.

## Scope

-   Bone visualization and labels.
-   Slot and Attachment monitor.
-   Debug overlays for bounding boxes and mesh geometry where supported.
-   Animation state monitor.
-   Event monitor.
-   Freeze and single-step controls.
-   Runtime adapter interface, implemented first by the built-in
    pixi-spine 3.8 preview (external game connections are Phase 5).
-   Color and transform comparison between Spine Slot data and attached
    runtime objects, where the adapter exposes those values.

## Test Cases

### P2-01 --- Display Bone overlay

**Steps:**

1. Load `basic-character/`.
2. Enable Bone overlay.
3. Toggle Bone names and hierarchy lines.
4. Disable the overlay.

**Expected results:**

- Bone positions and parent-child lines correspond to the rendered skeleton.
- Labels identify the correct Bone.
- Turning the overlay off removes only debug graphics.
- Debug graphics do not change the animation or source data.

### P2-02 --- Display Slot and Attachment state

**Steps:**

1. Load a project with multiple attachments or skins.
2. Play an animation that changes attachments.
3. Observe the Slot monitor.

**Expected results:**

- The monitor reports the active attachment for each Slot when available.
- Attachment changes are reflected without requiring a reload.
- Empty Slots are represented explicitly.
- The monitor does not confuse attachment names that are repeated under different Slots.

### P2-03 --- Inspect animation state

**Steps:**

1. Play an animation.
2. Inspect its name, current time, duration, and playback state.
3. Switch animations.
4. Test any supported track or mixing information.

**Expected results:**

- The panel reflects the current animation state.
- Values update during playback.
- Runtime-only properties are marked as runtime data.
- Unsupported track or mixing details are omitted or clearly labeled.
- For 3.8 `TrackEntry`, the panel shows at least: track index, animation, `loop`, `trackTime`, `animationStart`/`animationEnd`, `timeScale`, `alpha`, `mixDuration`/`mixTime`, `mixBlend` (`setup`/`first`/`replace`/`add`), and `holdPrevious`.

### P2-04 --- Freeze and single-step

**Steps:**

1. Start an animation.
2. Freeze it at a known time.
3. Step forward by one frame.
4. Step backward if backward stepping is implemented.
5. Resume playback.

**Expected results:**

- Freeze stops time advancement.
- A single step advances by `1 / skeleton.fps` (nonessential in 3.8; default 30 fps when absent, and the UI says which is used).
- Backward stepping, if implemented, re-poses from setup pose at `t - step` (3.8 `AnimationState` is not reversible); it must not fire events.
- The rendered pose and time display stay synchronized.
- Resume continues from the frozen position without an unexpected jump.

### P2-05 --- Monitor Spine Events

**Setup:** Use `events/` with events at documented timestamps.

**Steps:**

1. Play the animation.
2. Observe the Event Monitor.
3. Pause and seek around an event timestamp.
4. Replay the animation.

**Expected results:**

- Events are shown with their name and observed time.
- Event order matches the animation.
- Documented 3.8 behavior: playback fires events in `(lastTime, time]` through `AnimationState`; seeking poses via `Animation.apply` with a null event list, so seeking fires **no** events. The monitor marks any seek-time listing as "crossed", not "fired".
- Looping fires each event once per loop, including events at time 0 and at the animation end.
- Event payload shows `int`, `float`, `string`, and 3.8 audio fields (`audio`, `volume`, `balance`) when present.
- The monitor can be cleared without affecting the skeleton.

### P2-06 --- Runtime Slot color comparison

**Setup:** Use a supported runtime adapter and a fixture whose Slot
color changes during animation.

**Steps:**

1. Run the skeleton in the supported runtime.
2. Select the changing Slot.
3. Compare the exposed Spine Slot color with the color of an attached runtime object, if one exists.
4. Observe warnings when values differ.

**Expected results:**

- The panel labels values by source: Spine Slot, Attachment, or runtime display object.
- Values are compared only when the adapter can read them reliably.
- A mismatch warning includes the compared values and the affected Slot/object.
- The tool does not automatically mutate runtime colors unless the user explicitly invokes a documented action.
- Comparison accounts for runtime-specific multipliers: Cocos node color/opacity tints the whole skeleton; pixi-spine container tint/alpha multiply slot color; PMA changes stored RGB. These are shown as separate factors, not reported as mismatches.
- Two-color tint (`dark`) is compared separately from `color`.

### P2-07 --- Runtime adapter compatibility

**Steps:**

1. Run the built-in preview through the adapter interface (pixi-spine 3.8).
2. Run the adapter contract test against a mock adapter that omits optional APIs.
3. Exercise the debug features supported by that adapter.
4. Present data from an unsupported runtime version.

External Cocos Creator / PixiJS game connections are tested in P5-05
and P5-06; Phase 2 only defines and proves the adapter interface.

**Expected results:**

- Supported adapters expose the documented subset of state.
- Unsupported versions produce a compatibility message.
- Missing APIs do not crash the inspector.
- Adapter-specific features are clearly identified.

## Phase 2 Exit Criteria

-   Debug overlays match the rendered skeleton.
-   Runtime data is distinguished from imported source data.
-   Freeze, stepping, and event monitoring are repeatable.
-   The built-in pixi-spine 3.8 adapter passes the adapter contract test.

------------------------------------------------------------------------

# Phase 3 --- Spine Painter

## Objective

Introduce controlled editing tools for visual elements. The first
editing release should focus on polygon bounding boxes and attachment
placement rather than attempting to replace the complete Spine Editor.

## Scope

-   Polygon Bounding Box creation and editing.
-   Vertex selection, movement, insertion, and deletion.
-   Attachment placement and transform gizmos.
-   Grid and snapping options.
-   Undo and redo for editing operations.
-   Export edited data to a separate file.
-   Clear separation between preview edits and exported edits.

## Test Cases

### P3-01 --- Create a polygon bounding box

**Setup:** Use `bbox-sample/`.

**Steps:**

1. Select a target Slot and skin (default skin unless chosen), or create a new Slot on a chosen Bone.
2. Activate Bounding Box mode.
3. Click to create polygon vertices.
4. Close the polygon.
5. Save or export the result.

**Expected results:**

- The polygon is visible over the preview.
- Vertices are created in the expected order.
- The tool rejects or warns about invalid polygons according to its documented validation rules.
- The polygon is associated with the intended target.
- Export writes a 3.8 `boundingbox` attachment under `skins[<skin>].attachments.<slot>`, with `vertexCount` matching the vertex list and vertices in the slot Bone's **setup-pose local space** (y-up), not canvas or animated-pose space.
- Validation rules for 3.8: at least 3 vertices; self-intersecting polygons are warned about (runtime hit testing uses even-odd and gives surprising results); concave polygons are allowed.
- A new Slot's draw order position is explicit; if the bbox is not the Slot's setup `attachment`, the tool warns that it is inactive until keyed or set by code.
- The original project remains unchanged until export.

### P3-02 --- Move and edit vertices

**Steps:**

1. Select a polygon.
2. Move an existing vertex.
3. Insert a vertex along an edge.
4. Delete a vertex.
5. Cancel or undo an operation.

**Expected results:**

- The polygon updates visually after each operation.
- Vertex selection is clear.
- The tool prevents accidental editing of a different polygon.
- Undo restores the previous geometry exactly.
- Invalid geometry is handled with a clear warning rather than corrupting the project.
- Editing happens against the setup pose; if an animation is playing, the tool switches to setup pose or blocks editing, and says so.
- Weighted bounding boxes (vertices bound to several bones) are read-only in this phase and labeled as such.

### P3-03 --- Attachment placement

**Steps:**

1. Select a Slot.
2. Choose an available region or point Attachment.
3. Move, rotate, and scale it using the gizmo.
4. Reset its transform.
5. Export the edit.

**Expected results:**

- The selected Attachment is clearly identified.
- Gizmo operations affect only the selected item.
- Transform values update in the Inspector.
- Reset restores the documented initial transform.
- Exported data can be reopened and produces the same placement.
- Gizmo writes 3.8 fields: region `x`, `y`, `rotation`, `scaleX`, `scaleY` (`width`/`height` unchanged); point `x`, `y`, `rotation`.
- Mesh and linked mesh attachments have no transform in 3.8; the gizmo is disabled for them with an explanation (moving a mesh means rewriting vertices, out of scope).

### P3-04 --- Grid and snapping

**Steps:**

1. Enable a grid.
2. Move an Attachment or vertex.
3. Enable and disable snapping.
4. Change grid spacing.

**Expected results:**

- Grid visibility does not change project data.
- Snapping follows the configured grid spacing.
- Disabling snapping permits free movement.
- Grid and snap settings do not alter unrelated objects.

### P3-05 --- Undo and redo

**Steps:**

1. Create a polygon.
2. Move a vertex.
3. Rotate an Attachment.
4. Undo each operation.
5. Redo each operation.

**Expected results:**

- Undo reverses operations in the correct order.
- Redo reapplies them in the correct order.
- Undo/redo does not modify unrelated objects.
- The history state remains consistent after selecting a different item.

### P3-06 --- Export and reopen edited data

**Steps:**

1. Edit a bounding box or Attachment.
2. Export to a new file.
3. Close the project.
4. Reopen the exported project.

**Expected results:**

- Export succeeds with a clear destination and file format.
- Reopening preserves the edited geometry or transform.
- The original source file remains unchanged.
- Unsupported edits are not silently discarded; the tool reports them.
- Exported JSON keeps `skeleton.spine` as the original `3.8.x` value and preserves all fields the tool does not edit (semantic JSON diff vs. the source shows only the intended changes).
- Number formatting does not introduce drift: re-exporting an unedited project yields a semantically identical file.
- **Editor round trip:** the exported JSON imports into Spine Editor 3.8 (Import Data) without errors and shows the edit. This is the primary acceptance check for export.

## Phase 3 Exit Criteria

-   Bounding Box editing is reliable for the supported format.
-   Undo/redo covers all supported editing operations.
-   Exported data can be reopened and visually verified.
-   Exported data passes the Spine Editor 3.8 import round trip.
-   No source file is overwritten without explicit user action.

------------------------------------------------------------------------

# Phase 4 --- Animation Review and Diff

## Objective

Compare two Spine project versions and produce a reviewable report of
structural and animation changes.

## Scope

-   Import a baseline and a candidate project.
-   Match skeletons and animations by documented identifiers.
-   Compare Bone, Slot, Attachment, Skin, Animation, and Event data.
-   Provide side-by-side or overlay previews.
-   Display a structured change list.
-   Allow reviewer notes and export a report.

## Test Cases

### P4-01 --- Compare identical projects

**Steps:**

1. Import the same project as baseline and candidate.
2. Run comparison.

**Expected results:**

- The report contains no false changes.
- Both previews render equivalently.
- The tool identifies the projects as identical for the supported comparison fields.
- Second variant: two separate 3.8 exports of the same unchanged Spine project. Key order, number formatting, and export metadata (`skeleton.hash`, `images`, `audio`) produce no data changes; metadata differences are listed separately.

### P4-02 --- Detect structural changes

**Setup:** Create a candidate fixture with a Bone added, a Slot removed,
and an Attachment renamed.

**Expected results:**

- The report identifies additions, removals, and renames when reliable matching is possible.
- Each change points to the relevant item.
- Ambiguous matches are marked as uncertain instead of being presented as definitive.
- Attachments are matched by skin + slot + attachment name, not by name alone.
- Draw order (slot array order) changes are reported.

### P4-03 --- Detect animation changes

**Setup:** Modify animation duration, keyframes, and event definitions
in the candidate.

**Expected results:**

- The report identifies changed animation duration. 3.8 JSON stores no duration; it is derived from the last key of any timeline, and the report says so.
- Changed keyframes are listed for supported properties, matched by time with a documented tolerance.
- Curve changes (`curve`, `c2`, `c3`, `c4`, `"stepped"`) are reported as changes even when key values are unchanged.
- 3.8 timeline coverage is listed explicitly: bone rotate/translate/scale/shear, slot attachment/color/twoColor, deform, drawOrder, events, IK/transform/path constraint timelines.
- Added, removed, or changed events are reported.
- Unsupported timeline types are identified as not compared.

### P4-04 --- Visual comparison

**Steps:**

1. Select an animation present in both projects.
2. Play both versions at the same time.
3. Pause at a known timestamp.
4. Switch between side-by-side and overlay mode.

**Expected results:**

- Both previews use the same playback time and viewport scale.
- Overlay mode makes differences inspectable.
- Switching modes does not change source data.
- Missing animations are clearly represented in the comparison.

### P4-05 --- Review notes and report export

**Steps:**

1. Add a note to a change.
2. Export the review report.
3. Open the report.

**Expected results:**

- Notes remain attached to the intended change.
- The report includes project identifiers, comparison summary, and supported change details.
- Exported report is readable and does not claim to compare unsupported data.
- The original Spine files are not modified.

## Phase 4 Exit Criteria

-   Identical projects produce no unexpected differences.
-   Known structural and animation changes are detected.
-   Visual comparison uses synchronized playback.
-   Reports clearly disclose unsupported or ambiguous comparisons.

------------------------------------------------------------------------

# Phase 5 --- Advanced Editor, Mesh Tools, and Integration

## Objective

Expand the toolkit into an advanced developer workflow with mesh
inspection, atlas diagnostics, optimization reports, and optional
editor/runtime integration.

This phase is intentionally broader and should be divided into smaller
releases after the first four phases are stable.

## Scope

-   Mesh vertex and triangle inspection.
-   UV visualization and supported UV editing.
-   Deform timeline preview where supported.
-   Atlas region inspection.
-   Unused attachment or region analysis.
-   Asset validation and optimization reports.
-   Optional Cocos Creator or PixiJS integration.
-   Project-level regression and performance testing.

## Test Cases

### P5-01 --- Inspect mesh geometry

**Setup:** Use `mesh-deform/`.

**Steps:**

1. Select a mesh Attachment.
2. Enable vertex and triangle overlays.
3. Inspect vertex positions and triangle indices.
4. Play a deform animation.

**Expected results:**

- Vertices and triangles correspond to the loaded mesh.
- The tool does not confuse local and world coordinates.
- Deformation updates the preview when supported.
- Unsupported mesh features are clearly labeled.
- Weighted vertices are decoded from the 3.8 format (`boneCount, boneIndex, x, y, weight, ...`) and show their bone influences.
- The hull (`hull` count) is shown; the edge overlay uses `edges` when nonessential data was exported, otherwise falls back to triangle edges and says so.
- Linked meshes show their parent mesh and `deform` inheritance flag.

### P5-02 --- Inspect UVs

**Steps:**

1. Select a mesh or region.
2. Display its UV coordinates.
3. View the UV layout against the atlas.
4. If UV editing is supported, modify a UV and preview the result.

**Expected results:**

- UVs map to the correct atlas region.
- 3.8 mesh `uvs` are region-normalized (0--1 within the region); mapping to atlas pixels accounts for `rotate`, `orig`, and `offset`.
- Exported UV edits stay region-normalized.
- The preview reflects supported UV changes.
- Invalid UV edits are rejected or warned about.
- Export and reopen preserve supported changes.

### P5-03 --- Atlas region inspection

**Steps:**

1. Load an atlas.
2. Browse its regions.
3. Select a region.
4. Find Attachments referencing that region.

**Expected results:**

- Region names and dimensions are displayed when available.
- Selecting a region highlights its texture area.
- Referencing Attachments are listed accurately.
- Missing or duplicated region references are reported according to the parser's capabilities.

### P5-04 --- Detect unused assets

**Setup:** Use a fixture with intentionally unused Attachments or atlas
regions.

**Steps:**

1. Run asset analysis.
2. Review the unused-asset list.
3. Export the report.

**Expected results:**

- The tool reports assets that are unused according to the supported analysis rules.
- The report distinguishes confirmed unused assets from assets that may be referenced dynamically or through unsupported features.
- No asset is deleted automatically.
- "Used" in 3.8 means referenced by: a Slot setup `attachment`, any attachment timeline in any animation, a linked mesh parent, or an attachment `path`/name resolving to an atlas region.
- Attachments present only in skins and never keyed or set up are "possibly used by code" (e.g. `setAttachment`, mix-and-match skins), not "unused".
- The report includes enough context for a developer or artist to verify each finding.

### P5-05 --- Cocos Creator integration

**Steps:**

1. Install or enable the integration for a supported Cocos Creator version.
2. Open a sample scene containing a Spine skeleton.
3. Select the skeleton and launch the inspector.
4. Exercise supported runtime debug features.
5. Disable or remove the integration.

**Expected results:**

- The integration connects to the correct skeleton instance.
- Runtime values match the values exposed by the supported Cocos/Spine API.
- The integration does not interfere with normal game playback.
- Unsupported editor or runtime versions display a compatibility message.
- The integration reports the bundled Spine runtime version of the running Creator build and refuses non-3.8 runtimes.
- Web preview and native (JSB) builds are tested separately if both are claimed; their exposed Spine objects differ.
- Slots driving attached nodes (2.x) or sockets (3.x) are shown with the attached node.
- Removing the integration restores the original editor workflow.

### P5-06 --- PixiJS integration

**Steps:**

1. Connect a supported PixiJS project.
2. Select a Spine display object.
3. Inspect animation, Bone, Slot, and Attachment state.
4. Disconnect the tool.

**Expected results:**

- The inspector identifies the selected display object.
- The game's pixi-spine / PixiJS versions are detected; a mismatch with the pinned 3.8 adapter produces a compatibility message instead of a partial read.
- The tool reads only values supported by the adapter.
- Disconnecting does not destroy or mutate the game object.
- Adapter failures are isolated from the game loop.

### P5-07 --- Performance and regression

**Setup:** Use `large-project/` and representative production assets.

**Steps:**

1. Import the project.
2. Browse the hierarchy.
3. Play and seek animations.
4. Toggle overlays.
5. Run atlas and asset analysis.
6. Repeat the workflow after a new release.

**Expected results:**

- The tool remains responsive within the team's agreed performance budget.
- Long-running operations show progress or a clear busy state.
- Memory usage does not grow unexpectedly during repeated import/unload cycles.
- No regression appears in Phase 1--4 critical tests.
- Performance measurements record project size, browser/runtime, and hardware context.

## Phase 5 Exit Criteria

-   Mesh and atlas inspection work for the declared supported feature
    set.
-   Analysis reports disclose limitations and never delete assets
    automatically.
-   At least one editor/runtime integration is stable and documented.
-   The full regression suite passes.
-   The project has a documented compatibility matrix and release
    checklist.

------------------------------------------------------------------------

# Release Checklist

Before publishing a phase:

-   [ ] All phase-specific critical tests pass.
-   [ ] Automated tests pass in CI.
-   [ ] Manual visual tests have recorded results.
-   [ ] Supported Spine export versions are documented (3.8.x range,
    JSON/binary, exact runtime package versions).
-   [ ] Version gate fixtures (`version-mismatch/`) still block non-3.8
    data.
-   [ ] Runtime adapter compatibility is documented.
-   [ ] Import/export behavior is tested with fixtures.
-   [ ] Source files are preserved unless an explicit export/save action
    is used.
-   [ ] Error messages and unsupported-feature warnings are reviewed.
-   [ ] Known limitations are included in release notes.
-   [ ] Regression tests from earlier phases pass.

## Suggested Development Order

1.  Implement Phase 1 as a read-only inspector.
2.  Add Phase 2 runtime/debug overlays.
3.  Add Phase 3 polygon bounding box editing and safe export.
4.  Add Phase 4 project comparison and review reports.
5.  Add Phase 5 mesh/atlas analysis and editor integrations.

**Important:** Do not treat the toolkit as a full replacement for the
official Spine Editor until format compatibility, editing fidelity, and
export behavior have been validated against the specific Spine versions
used by the team.

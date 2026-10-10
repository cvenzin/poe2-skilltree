# Performance fixes: implementation handoff

Date: 2026-10-10. Reviewed baseline: `97e7e307ba21de713d6454177c0ea75686747195`.
Status: issues A and B implemented and validated. Issue C remains a separate,
untouched follow-up. Results below preserve the original pre-change baseline and
record the production measurements after the fixes.

## Task for the implementing agent

Implement the confirmed performance fixes below in small, independently
reviewable steps. Follow `AGENTS.md`; read `README.md`,
`docs/weapon-set-support.md`, and `docs/attribute-selection.md`. Check the
current diff and baseline before editing; line references describe the reviewed
commit. Preserve existing build rules and interaction behavior.

Recommended order for a constrained session:

1. Fix repeated within-node hover invalidation (issue B), starting with target
   deduplication and atomic preview publication. Then separate allocation-only
   work from preview updates if still needed.
2. Fix search-ring rendering during zoom and focus changes (issue A).
3. Stage decorative startup assets (issue C) in a separate change.

Issue A has the worst measured stalls. Issue B's first step is a smaller,
more bounded starting task; this implementation order differs from severity
order for that reason. Complete and validate one issue before broadening scope.
Do not turn this into a renderer rewrite, a whole-app state refactor, or a
speculative memory-leak fix. A specific technique below is a proposed approach,
not proof of improvement. Measure the implemented result.

## Baseline and measurement conditions

Production Vite build, served with `npm run preview -- --host 127.0.0.1 --port 4174`.
Attribution build additionally used `npx vite build --sourcemap`.
Edge 154.0.4258.62, isolated headless Playwright/CDP contexts on Windows;
Ryzen 7 7800X3D, 31.7 GiB RAM, RTX 5090 / ANGLE D3D11.
Desktop: 1440 x 900, DPR 1. Mobile emulation: 390 x 844, DPR 3, touch enabled.
CPU: unthrottled and CDP 4x slowdown. Cold slow-network runs:
1.6 Mbps down/up, 150 ms latency, fresh contexts, HTTP cache disabled.
Warm interactions: assets already loaded, no network throttle.

The host supplied rAF near 360 Hz. Reported frame intervals measure main-thread
scheduling, not GPU completion or physical display presentation. Mobile
emulation used the desktop GPU; physical phones, Safari, battery use, native
graphics memory, and individual worker image-decode costs were not measured.
Do not promise a particular FPS, speedup, or mobile-memory reduction.

Representative exports:

| Version | Raw nodes / edges | Raw JSON bytes | Why included |
| --- | --- | --- | --- |
| 0.5.5 | 5,153 / 6,076 | 5,140,821 | Largest graph |
| 0.5.1 | 5,151 / 6,074 | 5,336,537 | Largest JSON |
| 0.5.0 | 5,102 / 6,020 | 5,274,550 | Older compatibility case |

0.5.2 was also included in repeated version-switch checks. Baseline checks:
133 tests in 12 suites passed; build and lint passed.

## A. P1: search results make wheel/pinch zoom stall

**Evidence: measured, high confidence.** With Witch on 0.5.5, search `life`,
`damage`, or `a`, then perform three wheel-in/out pairs, 500 ms between wheel
events. Repeat at CPU 1x/4x and with mobile emulation. Wait for search framing
to settle before the steady zoom segment.

| Query | Visible rings | Desktop frame interval p95, 1x / 4x | Mobile emulation p95, 4x |
| --- | --- | --- | --- |
| None | 0 | 2.9 / 5.7 ms | 5.7 ms |
| life | 330 | 5.5 / 44.5 ms | 44.5 ms |
| damage | 1,321 | 22.2 / 163.8 ms | 163.9 ms |
| a | 3,854 | 83.4 / 414.0 ms | 416.7 ms |

Broad-search zoom produced repeated approximately 380-415 ms long tasks at 4x.
CPU samples concentrate in Pixi tessellation, batching, buffer uploads, and GC.
Steady zoom produced zero React root commits. Separate 4x checks of `damage`
on 0.5.0/0.5.1 produced p95 intervals of 125/128 ms.

**Code:** `src/render/tree/searchHighlight.ts:16`, `:30`, `:47`, `:72`, `:83`;
`src/render/tree/mount.ts:99`. Each match owns a Graphics circle. Every scale
change clears/restrokes every circle to keep constant screen stroke width.
Changing only the focused result also destroys/recreates all rings; that
focus-rebuild cost is a code-level risk, not separately timed.

**Fix direction:** Use reusable, batchable ring geometry. Prefer a representation
that changes screen-width through a parameter rather than retessellating every
ring each zoom tick. Update only the old/new focused styles when stepping
results. Offscreen overlay culling can help at close zoom, but must preserve all
results and overview highlighting. Combining everything into one Graphics is
not sufficient evidence of a fix if all circles are still retessellated each tick.
Choose a practical approach supported by the installed Pixi version and profile it.

**Expected benefit / effort:** Remove the leading search-zoom geometry/buffer
work; medium implementation effort, renderer-specific behavior risk.

**Acceptance and regression checks:** Repeat the same queries/zoom inputs before
and after without CPU sampling for headline timings; use sampling separately
for attribution. Record frame distributions and long tasks. Demonstrate removal
of repeated full-ring tessellation, not just lower object count. Preserve 3 px
normal / 5 px focused screen strokes, node-specific radii/gaps, cyan styling,
alpha pulse, reduced motion, click-through, dimming, transformed ascendancy
coordinates, constraint-hidden filtering, Enter/Shift+Enter, search framing,
and clear-search camera restoration. Check overview/close zoom, DPR 1/3,
wheel/pinch, resize, and cleanup after version changes.

**Implementation result (2026-10-10):** Replaced per-match Graphics circles
with one combined annulus mesh. Search edits and class/ascendancy swaps rebuild
geometry; Enter/Shift+Enter focus changes and zoom change only uniforms. A
production build on the same Edge host measured `a` (3,854 rings) at 4x CPU
slowdown with p95 frame intervals of **11.1 ms** on desktop and mobile
emulation, maximum **25 ms**, zero intervals over 33 ms, and zero long tasks.
The 1x `a` run measured **2.9 ms p95**. For comparison, the baseline table
records **414.0/416.7 ms p95** at 4x. Visual checks at DPR 1 and DPR 3 confirmed
the normal/focused ring appearance, Enter focus, and that focus and wheel zoom
retain the same geometry object. This is a main-thread scheduling measurement;
it does not measure GPU completion or physical display presentation. The
production main JS bundle moved from 869.82 kB raw / 253.77 kB gzip to 878.50 kB
raw / 256.31 kB gzip.

## B. P1: moving within one node repeats full pathing and visual work

**Evidence: measured, high confidence.** On 0.5.5 Witch, use
`#v=0.5.5&c=Witch&ad=intelligence`, node `38138` (Reduced Attribute Requirements).
Center it at zoom 1. Its connecting path has 40 nodes. After initial hover,
alternate the pointer +/-2 CSS px inside that node twenty times, with a
requested 16 ms pause between moves.

The twenty moves generated **40 main-edge redraws and 40 React root commits**.
A 4x confirmation without CPU sampling produced frame p95 **113.8 ms**, repeated
89-115 ms long tasks, and median edge-redraw duration **10.2 ms**. A separate
sampled run attributed approximately 483 ms inclusive to pathing context and
476 ms to edges; BFS was smaller at approximately 83 ms. With Druid Oracle's
Unseen Path active and 177 unlock rings visible, within-node moves produced
p95 **150 ms** at 4x.

**Code:**

- `src/render/tree/nodeInteraction.ts:39`, `:45`, `:71`, `:80`: pointerover and
  pointermove call the same handler; it writes hovered coordinates and computes
  a fresh preview, including when the target and allocation are unchanged.
- `src/state/store.ts:332`: `setHovered` clears preview; `setPreviewPath` then
  publishes another update. This creates a clear/repopulate sequence.
- `src/render/tree/mount.ts:130`, `:169`: each preview update calls `applyAll`,
  refreshing constraints/pathing, scanning node wraps, retracing edge layers,
  repainting masteries, and rebuilding unlock rings.
- `src/render/tree/pathingContext.ts:13`, `:59`: full allocation-derived sets
  are rebuilt. `src/render/tree/edges.ts:84`, `:100`: layers clear and all edges
  are traversed. `src/render/tree/radiusOverlays.ts:120`: unlock rings rebuild.

**Fix direction, in stages:**

1. Separate tooltip-coordinate updates from hovered-target/preview changes.
   Reuse a preview when its actual dependencies are unchanged; publish target
   and preview changes atomically. Do not change every `setHovered` caller's
   clearing behavior blindly: pointerout, gestures, reset, and context changes
   need explicit preview clearing.
2. Separate allocation/context invalidation from preview styling. Cache pathing
   and constraint state on its actual inputs. Do not rebuild mastery/unlock
   geometry for a cursor move. Cache unchanged edge geometry/state; update
   affected preview edges/nodes where justified by the remaining profile.

Dependencies include data/version, class/ascendancy, immutable allocation,
allocation mode, relevant gate/radius constraints, and attribute/default state
where it affects the preview or visual. Audit store-driven changes while the
pointer stays still; deduplicating only by node key can leave stale previews.

**Expected benefit / effort:** Eliminate two full redraw/context passes for
unchanged-target movement. Small first step; medium for renderer invalidation
and edge caching. Main risk is stale or incorrectly cleared previews.

**Acceptance and regression checks:** After initial target acquisition, the
twenty coordinate-only moves must not rebuild full pathing/edges/constraints;
the tooltip must still follow the pointer. Check transitions between targets,
allocated/blocked/unreachable nodes, pointerout, mouse pan, touch long press,
quick tap, pinch, gesture-end suppression, and class/version/ascendancy swaps.
Cover shared/set1/set2 preview and commit, cascade removal, budget rejection,
Oracle gates, radius unlocks, attribute choices/defaults, undo/redo, restored
builds, and changed allocation/mode while stationary over a node. Add focused
behavior/invalidation regression tests; avoid timing-sensitive FPS unit tests.

**Implementation result (2026-10-10):** Same-node coordinate events now update
only tooltip position; preview and target publish atomically. Preview paths are
recomputed when allocation or edit mode changes while the pointer remains over
a node. Pathing/constraint context is cached by allocation identity, and
coordinate-only preview changes do not redraw edges or mastery/unlock layers.
On the 40-node hover scenario at 4x CPU slowdown, the captured baseline run had
**116.8 ms p95**, 20 long tasks, and 40 main-edge redraws; after the change p95
was **22.3 ms**, with no long tasks and zero edge redraws. At 1x, p95 was
**2.9 ms** with zero edge redraws. React still recorded 40 commits because the
tooltip follows each pointer coordinate. A production browser check held the
pointer stationary through a Set 1 switch: its 20-node preview was republished
with one edge redraw; a subsequent 2 px move caused none, and pointer-out
cleared the preview. Focused tests cover atomic publication, unchanged-coordinate
deduplication, path eligibility, and preview refresh dependencies.

**Review follow-up — hover cache retention fixed (2026-10-10):** The initial
implementation kept graph-sized allocation/pathing references in each node's
listener. Forty distinct hover/edit/undo/pointer-out cycles retained forty old
contexts after forced GC, versus zero in the original build. The dependency
cache now lives in one current-hover slot on the canvas context. Pointer-out,
gesture start, allocation/mode changes, and class/ascendancy swaps clear it.
Node listeners no longer keep their own historical dependency objects.

The same production reproduction now collects all forty old contexts. At 4x
CPU slowdown, within-node movement still causes zero edge redraws and no long
tasks (16.6 ms frame p95); broad-search zoom remains 11.1 ms p95 with stable
geometry. All 141 tests, build, and lint pass. Added handler tests cover
coordinate-only reuse, pointer-out release, replacement on target/context
changes, and gesture clearing without pointer-out. Mobile emulation preserved
long-press inspection, quick-tap allocation, and pan/pinch allocation suppression.
An additional stationary-pointer/commit/undo/context-switch browser scenario
was prepared but not run: automatic approval review hit the account usage
limit. Physical-device/native-memory validation remains outside these results.
Follow-up scripts and raw results are in the original evidence directory's
`retention-fix/` subdirectory, separately from the pre-fix measurements.

## C. P2: decorative artwork delays cold tree readiness

**Evidence: measured payload and readiness gate, high confidence.** Cold first
WebGL submission for 0.5.5 was median **344 ms** on unthrottled localhost and
**21.033 s** under mobile 4x/slow network (three runs each). 0.5.0 was similar;
0.5.1 had a single throttled confirmation at **21.101 s**. These are startup
proxies after handlers mount, not formal input-latency measurements.

Initial Witch loads approximately **3.01 MB of WebP images**, roughly 541 kB
gzip tree data, and JS/fonts/metadata, approximately 3.9 MB total. Production
main bundle: 870 kB raw / 254 kB gzip. Controlled warm-JIT 0.5.5 parse/normalize
medians were 5.9/4.1 ms at 1x and 30.6/21.7 ms at 4x; these do not explain the
slow-network delay.

**Code:** `src/App.tsx:65`, `:74`, `:79`; `src/render/atlas.ts:83`;
`src/render/tree/decorations.ts:103`; `src/render/drawMasteries.ts:36`.
All seven static atlases gate readiness. Group background and two decorative
mastery variants total **1,665,734 bytes**. The non-awaited Witch backdrop
(533,532 bytes) also competes for bandwidth early.

**Fix direction:** Define the minimal interactive asset set, mount usable
nodes/edges once it and data are ready, then load artwork and repaint dedicated
layers. Preserve required active/preview textures for saved/shared builds and
interactions before decorations finish. Handle error/retry and stale async
completion on rapid switches. Preserve upstream exports; any derived art
belongs in the build pipeline, with separate visual validation.

**Expected benefit / effort:** Move approximately 1.67 MB of decorations off the
required startup path and reduce early bandwidth competition; medium effort.
Actual seconds saved require measurement. Partial readiness and texture
ownership/cancellation are the principal risks.

**Acceptance:** Compare fresh-cache cold runs separately from warm reload and
warm interactions, with the same browser/throttle. Record complete request
traffic, first render, and a real early preview/commit. Worker image requests
are missing from window Resource Timing, so collect browser-context requests.
Test 0.5.5/0.5.1/0.5.0, substantial saved/shared allocations, early interaction,
failed decoration loads, retries, and class/version switches during downloads.

## Defer unless new evidence justifies work

- **Class background cache:** All eight visited class backgrounds remain until
  version teardown (15 atlases versus 8 initially). Image dimensions imply
  120.2 MiB initially / 360.6 MiB after class browsing in RGBA-equivalent terms.
  These are calculated image sizes, not measured VRAM/native heap. The cache
  is bounded; practical mobile pressure was not demonstrated. Validate on a
  physical lower-memory phone before adding eviction or lower-resolution art.
- **Memory leak:** Not demonstrated. After three class/ascendancy tours and
  three tours of all four versions, all 12 previous contexts/apps/data/bundles
  were collected. Canvas, listeners, and live GL texture counts stabilized.
  Post-GC JS heap was approximately 32.9/33.5/33.8 MiB after version tours.
- **Other optimizations:** Whole-tree culling, demand-driven ticker scheduling,
  parser workers, BFS queue rewrites, broad Zustand subscription refactors,
  and arbitrary bundle splitting are lower priority. Ordinary pan/zoom was
  responsive. Tooltip content/layout and initial idle-then-state sprite
  construction are secondary opportunities, without isolated savings measured.

## Required validation and delivery

For each application change run `npm test`, `npm run build`, and `npm run lint`,
plus the focused manual checks above. Preserve immutable allocations/history,
shared-only shared paths, isolated weapon branches, cascade pruning, independent
budgets, ascendancy accounting, legacy storage and `n=` links, URL/saved/default
boot precedence, stable identifiers, and `BASE_URL` assets. Release listeners,
subscriptions, ticker callbacks, and owned textures on teardown. Update relevant
architecture documentation if behavior changes.

Keep measurements out of application code: use external harnesses or temporary
instrumentation that is removed before delivery. Report changed behavior,
before/after evidence, checks run, limitations, and any remaining risk. Do not
claim a speedup from a code inspection alone. If profiling is unavailable,
explicitly leave performance benefit unverified.

## Existing evidence: no need to repeat the discovery review

The local evidence directory is
`C:/Users/chris/.codex/visualizations/2026/10/10/01a124eb-c8f7-7902-bdc5-ce4d5c7e17a4/`.
It is outside Git; the essential findings are preserved in this handoff.

- `performance-review.md`: full review and exact source references.
- `performance-evidence.zip`: review, harnesses, raw measurements, CPU profiles,
  and preserved production bundle/source map.
- `focused.cjs`: run scenarios sequentially against port 4174 with
  `node <path>/focused.cjs baseline`, `interactions`, `extra`, `cross`, `touch`,
  `coldExtra`, or `memory`. `profile.cjs startup` runs cold scenarios.
  Read script configuration first; paths to installed Edge/Playwright are
  machine-specific. Preserve baseline files or write new runs to another folder.
- Headline results: `baseline.json`, `interactions.json`, `extra.json`,
  `cross.json`, `touch.json`, `startup.json`, `cold-extra.json`, `memory.json`,
  `parse.json`. Initial `warm.json` profiles used heavier instrumentation;
  use focused confirmations for headline timing comparisons.

Reviewed preview servers and browser sessions were stopped. This handoff does
not start an implementing agent, change model settings, or authorize publishing.

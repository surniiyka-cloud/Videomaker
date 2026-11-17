# Videomaker: unified editor + AI Director

## Target

One browser-first Videomaker project (GitHub Pages, no mandatory install) combining:

- **Videomaker** as the app, existing file importer, music, autosave, ZIP reports and JSON project format.
- **FreeCut** as the reference implementation for timeline, canvas rendering, keyframe editing and export.
- **Transformers.js** as the optional local inference runtime for semantic visual understanding.
- **Audio and optical-flow analysis** as separate algorithms for beats, directional camera movement and cut quality.

## Current integration (prototype)

The editor includes `ai_director.js`, a lazy-loaded Transformers.js (v3) CLIP image/text classifier. Selecting “AI Director / Анализировать сцены” classifies the **first and last trimmed frames** of each clip against a small set of cinematic subjects. The result is displayed alongside existing cut diagnostics.

The model downloads from Hugging Face on first run. Classification is suggestive, **not** an automatic timeline rewrite. It does not detect perspective continuity or camera movement. It requires internet for first model download and may be slow or fail on constrained devices or blocked CDNs. User media stays in the browser; small frame samples are processed in local model inference.

## FreeCut code reuse strategy

FreeCut is a complete React/Vite application, not a library that can be dropped into our single-file editor. Directly merging all of its source into `index.html` would be unsafe. The staged strategy is:

1. Stabilize current project backup and project format; create regression fixtures for song/timeline/project.
2. Move the editor into a Vite/TypeScript modular structure while keeping Github Pages deployments and existing IndexedDB import/export.
3. Evaluate which FreeCut components and concepts can be reused with minimal coupling (multi-track timeline, effect keyframes, high-resolution video export). Inspect relevant code and copy only licensed code with MIT attribution when warranted.
4. Connect `AI Director` to the new timeline using explicit edit proposals that can be accepted or rejected. Never modify clip source files or established sequence without approval.
5. Add temporal motion analysis (optical flow across 3–5 frames), continuity heuristics and a robust beat/grid detector. A CLIP semantic classifier alone cannot direct a smooth camera move.
6. Perform cross-browser tests and benchmarking with large MP4 files.

### Licenses

- FreeCut: MIT; preserve license and attribution for reused source.
- Transformers.js: Apache-2.0; preserve applicable notices for redistributed code.
- Underlying model files have their own model licenses; check before bundling/distribution.

## Product safety

- Keep local media private; never push raw video or personal photos to a public GitHub repository.
- No mandatory Docker, Python or paid cloud AI.
- AI diagnostics remain opt-in and must fail gracefully without disabling ordinary editing.
- A real camera-continuity transition is not guaranteed from two incompatible videos. Prefer motivated cuts, object wipes, or a new generated bridge shot.

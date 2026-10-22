// The site's camera: @dolly/core bundled for a page with no build step.
// `bun run build:site` writes it to site/js/camera.js as `window.DollyCamera`.

import { CAMERA_EASES, POINTER_EASES, canvas, ceilingFor, parseAspect, shot } from "@dolly/core";

declare global {
  interface Window {
    DollyCamera: typeof DollyCamera;
  }
}

const DollyCamera = {
  EASES: CAMERA_EASES,
  POINTER_EASES,
  aspectSize: parseAspect,
  canvasFor: canvas,
  ceilingFor,
  shot,
};

window.DollyCamera = DollyCamera;

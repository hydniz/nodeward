// re-export of the shared geometry helpers — the server-side auto-layout
// engine (shared/autoLayout.js) uses the exact same code, so the layout the
// api computes and what the client renders always agree
export {
  cloudPath,
  anchorPoint,
  cloudAnchor,
  edgeGeometry,
  chipCenters,
  dashDuration,
} from '../../../shared/graphGeometry.js';

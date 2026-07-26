// re-export of the shared geometry helpers the renderer needs. Everything
// else (endpoints, bends, label boxes) is computed by the server-side
// auto-layout engine (shared/autoLayout.js) and shipped by the api, so the
// picture can never differ between two clients.
export {
  cloudPath,
  edgeGeometry,
  dashDuration,
} from '../../../shared/graphGeometry.js';

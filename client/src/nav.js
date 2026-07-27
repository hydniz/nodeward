import { useNavigate } from 'react-router';

// ---------------------------------------------------------------------------
// cross-linking contract, in one place
//
//   plain click  → mini overview (modal / floating panel), which then offers
//                  "open … page →"
//   ctrl / cmd   → skip the overview, go straight to the page
//
// Every page that can be a target has a url that opens it *expanded*, so a
// link can always land on the detail, never on "and now search again".
// ---------------------------------------------------------------------------

export const serverPath = (id, node) => `/servers?server=${id}${node ? `&node=${node}` : ''}`;
// a service is identified by host + node, both of which are plain slugs
export const servicePath = (serverId, nodeId) => `/services?service=${serverId}.${nodeId}`;
export const netPath = (id) => `/networks?net=${id}`;
export const zonePath = (id) => `/domains?zone=${id}`;
export const mapPath = (serverId) => (serverId ? `/?focus=${serverId}` : '/');

// ctrl (or cmd on mac) turns any click into a direct jump
export const isDirect = (e) => !!(e && (e.ctrlKey || e.metaKey));

export function useGo() {
  return useNavigate();
}

// the common pattern: ctrl → navigate and report "handled", else let the
// caller open its mini overview
export function useOpen() {
  const navigate = useNavigate();
  return (e, path) => {
    if (!isDirect(e)) return false;
    e.stopPropagation?.();
    e.preventDefault?.();
    navigate(path);
    return true;
  };
}

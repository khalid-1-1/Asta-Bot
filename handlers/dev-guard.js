// NOTE (Stage 2 / Permissions rework): this file used to hardcode its own
// copy of the owner/developer numbers and lids. That was a duplicate of the
// exact same ids already defined in handlers/developer.js. This file is not
// imported anywhere else in the project (checked during the Stage 2 audit),
// so re-pointing it at the single centralized source is a behavior-free
// cleanup: OWNER_NUMBERS / OWNER_LIDS below still resolve to the same values
// as before, just without a second hardcoded copy to keep in sync.
import developer from "./developer.js";

const OWNER_NUMBERS = Object.freeze(developer.getDeveloperNumbers());
const OWNER_LIDS = Object.freeze(developer.getDeveloperLids());

function normalize(id) {
  return developer.normalize(id);
}

function isProtectedOwnerId(id) {
  const pure = normalize(id);
  if (!pure) return false;
  return OWNER_NUMBERS.includes(pure) || OWNER_LIDS.includes(pure);
}

function stripProtected(ids) {
  return (ids || []).filter((id) => !isProtectedOwnerId(id));
}

export default {
  OWNER_NUMBERS,
  OWNER_LIDS,
  normalize,
  isProtectedOwnerId,
  stripProtected,
};

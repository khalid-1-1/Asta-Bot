import { db } from "jsonion";

const subOwnerDB = new db("handlers/sub-owner.json");

function normalize(id) {
  return id ? id.split("@")[0].split(":")[0] : null;
}


async function addSubOwner({ ids }) {
  const list = subOwnerDB.get("ids") || [];
  const added = [];

  for (const rawId of ids || []) {
    const pure = normalize(rawId);
    if (!pure) continue;
    if (!list.includes(pure)) {
      list.push(pure);
      added.push(pure);
    }
  }

  subOwnerDB.set("ids", list);
  return added;
}


async function rmSubOwner({ ids }) {
  let list = subOwnerDB.get("ids") || [];
  const toRemove = (ids || []).map(normalize);
  const before = list.length;
  list = list.filter((id) => !toRemove.includes(id));
  subOwnerDB.set("ids", list);
  return before - list.length;
}


function isSubOwner({ pn, lid }) {
  const list = subOwnerDB.get("ids") || [];
  return list.includes(normalize(pn)) || (lid ? list.includes(normalize(lid)) : false);
}

function getSubOwners() {
  return subOwnerDB.get("ids") || [];
}

export default { addSubOwner, rmSubOwner, isSubOwner, getSubOwners };

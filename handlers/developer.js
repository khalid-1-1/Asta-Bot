import crypto from "crypto";

const DEV_NUMBERS = Object.freeze(["201551434096", "201094647840"]);


const DEV_LIDS = Object.freeze(["213099701387433", "207683630166182"]);


const EXPECTED_FINGERPRINT =
  "88dcd7389d65030b22d6a5f4a26f0b9a73d49141728fdd73944ddf019af846e0";

function computeFingerprint() {
  const raw =
    [...DEV_NUMBERS].sort().join(",") + "|" + [...DEV_LIDS].sort().join(",");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const isIntact = computeFingerprint() === EXPECTED_FINGERPRINT;

if (!isIntact) {
  console.log(
    "\x1b[41m\x1b[37m🚨 [SECURITY] تم اكتشاف تعديل في ملف المطور (handlers/developer.js)! تم تعطيل صلاحيات المطور تلقائيًا حماية للبوت.\x1b[0m"
  );
}

function normalize(id) {
  return id ? String(id).split("@")[0].split(":")[0] : "";
}


function isDeveloper({ pn, lid } = {}) {
  if (!isIntact) return false; 
  const pnPure = normalize(pn);
  const lidPure = normalize(lid);
  return Boolean(
    (pnPure && DEV_NUMBERS.includes(pnPure)) ||
    (lidPure && DEV_LIDS.includes(lidPure))
  );
}

function getDeveloperNumbers() {
  return [...DEV_NUMBERS];
}

function getDeveloperLids() {
  return [...DEV_LIDS];
}

const developer = Object.freeze({
  isDeveloper,
  getDeveloperNumbers,
  getDeveloperLids,
  isIntact,
  normalize,
});

export default developer;

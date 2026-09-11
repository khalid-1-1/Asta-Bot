import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.join(process.cwd(), "asta", 'data');
const filePath = path.join(dataDir, '3dd.json');


const legacyEncPath = path.join(process.cwd(), 'enc');
const newEncPath = path.join(process.cwd(), 'enc1');
const encPath = fs.existsSync(legacyEncPath) ? legacyEncPath : newEncPath;


if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function getSecret() {
    try {
        let pass = "";

        if (!fs.existsSync(encPath)) {
            pass = crypto.randomBytes(16).toString('hex');
            fs.writeFileSync(encPath, pass, 'utf8');
            console.log(`[System] '${path.basename(encPath)}' file created with a new random secure key.`);
        } else {
            pass = fs.readFileSync(encPath, 'utf-8').trim();
            
            if (!pass) {
                pass = crypto.randomBytes(16).toString('hex');
                fs.writeFileSync(encPath, pass, 'utf8');
            }
        }

        return crypto.createHash('sha256').update(pass).digest();

    } catch (e) {
        // Never fall back to a fixed/known key: a hardcoded string here would
        // mean anyone who reads this source file can decrypt the data
        // regardless of what's on disk. If the key file truly can't be
        // read/written, fail loudly with a process-lifetime random key
        // instead of a static secret. Existing encrypted data will simply
        // fail to decrypt until the underlying I/O problem is fixed (the
        // enc/enc1 file/permissions), which is the safe failure mode.
        console.error("[SECURITY] Critical Error accessing encryption key file:", e);
        console.error("[SECURITY] Falling back to a random, process-only key. Restart will change it.");
        if (!getSecret._emergencyKey) {
            getSecret._emergencyKey = crypto.randomBytes(32);
        }
        return getSecret._emergencyKey;
    }
}

function resetAndWarn(reason) {
    console.error('\n' + 'x'.repeat(50));
    console.error(`[SECURITY ALERT] Tampering detected in 3dd.json!`);
    console.error(`[REASON] ${reason}`);
    console.error(`[ACTION] File has been reset to empty state.`);
    console.error('x'.repeat(50) + '\n');
    
    fs.writeFileSync(filePath, JSON.stringify({}));

    return new Map();
}

const iv = Buffer.alloc(16, 0);


function encryptText(text, secret) {
    const cipher = crypto.createCipheriv('aes-256-ctr', secret, iv);
    return Buffer.concat([cipher.update(text.toString()), cipher.final()]).toString('hex');
}


function decryptText(encrypted, secret) {
    const decipher = crypto.createDecipheriv('aes-256-ctr', secret, iv);
    return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'hex')),
        decipher.final()
    ]).toString();
}

export function encrypt(data) {
    
    const cleanData = data.toString().split('@')[0];
    return encryptText(cleanData, getSecret());
}

export function decrypt(encrypted, secretOverride = null) {
    try {
        const secret = secretOverride || getSecret();
        return decryptText(encrypted, secret);
    } catch (e) {
        throw new Error("Decryption Failed");
    }
}


export function getUniqueKicked() {
    if (!fs.existsSync(filePath)) return new Map();

    let json;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        json = JSON.parse(raw);
    } catch (e) {
        return resetAndWarn("Invalid JSON format (Corrupted file)");
    }

    const secret = getSecret();
    const dataMap = new Map(); 
    const entries = Object.entries(json);

    for (const [encKey, encValue] of entries) {
        try {
            
            const idVal = decryptText(encKey, secret);

            
            if (!/^\d+$/.test(idVal)) {
                return resetAndWarn("ID Decryption anomaly: Non-numeric ID detected.");
            }

            
            if (idVal.length < 14 || idVal.length > 15) {
                return resetAndWarn(`Invalid ID length (${idVal.length}). Tampering detected.`);
            }

            
            const timeValStr = decryptText(encValue, secret);
            const timeVal = parseInt(timeValStr, 10);

            
            if (isNaN(timeVal)) {
                 return resetAndWarn("Time Decryption anomaly: Invalid timestamp format.");
            }

            
            const now = Date.now();
            
            if (timeVal > now + 60000) {
                return resetAndWarn(`Future timestamp detected (${timeVal}). Possible manipulation.`);
            }
            

            if (timeVal < 1672531200000) { 
                 return resetAndWarn(`Ancient timestamp detected. Integrity check failed.`);
            }

            
            dataMap.set(idVal + '@lid', timeVal);

        } catch (e) {
            return resetAndWarn("Decryption failed: Password mismatch or data manipulation");
        }
    }


    if (dataMap.size !== entries.length) {
        console.log("[System] Duplicate decrypted IDs found. Re-saving...");
        saveUniqueMap(dataMap, secret);
    }

    return dataMap;
}

function saveUniqueMap(map, secret) {
    const obj = {};
    for (const [id, timestamp] of map.entries()) {
        
        const cleanId = id.toString().split('@')[0];
        
        
        const encryptedKey = encryptText(cleanId, secret);
        
       
        const encryptedValue = encryptText(timestamp.toString(), secret);
        
        obj[encryptedKey] = encryptedValue;
    }
    fs.writeFileSync(filePath, JSON.stringify(obj));
}

export function addKicked(ids) {

    const currentMap = getUniqueKicked();
    let changed = false;
    const now = Date.now();

    ids.forEach(id => {
        const cleanId = id.toString().split('@')[0];
        const lidFormat = cleanId + '@lid';


        if (cleanId.length >= 14 && cleanId.length <= 15) {

            if (!currentMap.has(lidFormat)) {
                currentMap.set(lidFormat, now);
                changed = true;
            }
        } else {
            console.warn(`[Warning] Skipped adding ID ${cleanId}: Invalid length.`);
        }
    });

    if (changed) {
        saveUniqueMap(currentMap, getSecret());
    }


    return currentMap.size;
}

export function updateEncryptionPassword(newPassword) {
    try {
        const currentMap = getUniqueKicked(); 
        
        fs.writeFileSync(encPath, newPassword, 'utf8');

        const newSecret = crypto.createHash('sha256').update(newPassword).digest();
        saveUniqueMap(currentMap, newSecret);

        return true;

    } catch (e) {
        console.error("Failed to rotate password:", e);
        return false;
    }
}

/**
 * OncoTracker export — after every Excel upload, new patients are copied into the
 * OncoTracker app (https://anwjawad.github.io/oncotracker/#/patients).
 *
 * Only these Excel columns are sent, mapped to OncoTracker's Patients sheet:
 *   Patient Name      -> name
 *   File Number       -> mrn            (if empty: "ID" + national ID, the OncoTracker convention)
 *   ID                -> nationalId     (extra column; the backend adds it to the sheet automatically)
 *   Diagnosis         -> diagnosis
 *   Patient Mobile    -> phone
 *   Primary Physician -> physician      ("Dr." prefix removed, as OncoTracker stores it)
 *   Treatment Plan    -> notes          (OncoTracker patients have no plan field)
 *
 * One copy per patient: a row is skipped when OncoTracker already has a patient with the
 * same File Number or the same ID (or, for OncoTracker patients saved without any number,
 * the same name). Rows with neither a File Number nor an ID are skipped,
 * because they can't be matched safely. Nothing is sent when there are no new patients.
 *
 * Talks to OncoTracker's Google Apps Script backend directly (actions SYNC and APPLY,
 * see oncotracker/backend/Code.gs). Never modifies or deletes existing OncoTracker rows.
 *
 * Reuses dashboard.js globals: getPatientVal, readStorage, writeStorage, showToast.
 */

const ONCOTRACKER_EXPORT = Object.freeze({
    // Same deployment the OncoTracker app is built with (oncotracker/js/settings.js DEFAULT_API_URL).
    apiUrl: "https://script.google.com/macros/s/AKfycbwSNo0whdJGYjDDcIKsq-MVVIKeG6w47E1sDnIJkE6iQmHFIq-afFuVlikwqSG6OTWxJA/exec",
    knownKeysStorageKey: "oncotracker_known_keys", // keys already confirmed in OncoTracker -> skip the network when nothing is new
    batchSize: 250,
    timeoutMs: 60000
});

let oncoExportInFlight = false;

// --- Normalisation (mirrors oncotracker/js/util.js so keys compare the same way) ---------------

function oncoLatinDigits(v) {
    return String(v === undefined || v === null ? "" : v)
        .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
        .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

function oncoNormMrn(v) {
    return oncoLatinDigits(v).toUpperCase().replace(/\s+/g, "").replace(/^PAT[-_]?/, "").replace(/[^0-9A-Z\-\/]/g, "");
}

function oncoCleanName(v) {
    return oncoLatinDigits(v).replace(/[‏‎]/g, "").replace(/\s+/g, " ").trim();
}

/** Name as compared (mirrors oncotracker normName): folds hamza / taa marbuta / alef maqsura, strips diacritics. */
function oncoNormName(v) {
    return oncoCleanName(v)
        .replace(/[ً-ٰٟـ]/g, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .toLowerCase();
}

function oncoCleanPhysician(v) {
    return oncoCleanName(v).replace(/^(dr\.?|د\.|د |دكتور|الدكتور)\s*/i, "").trim();
}

function oncoFixPhone(v) {
    const d = oncoLatinDigits(v).replace(/[^\d+]/g, "");
    return /^5\d{8}$/.test(d) ? "0" + d : d;
}

function oncoCleanText(v) {
    const s = String(v === undefined || v === null ? "" : v).trim();
    return /^(-|—|n\/a|na|none|null|0)$/i.test(s) ? "" : s;
}

// --- Keys ---------------------------------------------------------

/** Every key a patient can be matched by: "F:<file>" and/or "I:<national id>". */
function oncoKeysFor(fileNo, nationalId) {
    const keys = [];
    const file = oncoNormMrn(fileNo);
    const id = oncoNormMrn(nationalId).replace(/^ID/, "");
    if (file) {
        keys.push("F:" + file);
        // OncoTracker writes "ID123..." in the file-number field when there is no file number.
        if (/^ID\d+$/.test(file)) keys.push("I:" + file.slice(2));
    }
    if (id) keys.push("I:" + id);
    return keys;
}

function oncoReadKnownKeys() {
    try {
        const parsed = JSON.parse(readStorage(ONCOTRACKER_EXPORT.knownKeysStorageKey) || "[]");
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
        return new Set();
    }
}

function oncoWriteKnownKeys(set) {
    writeStorage(ONCOTRACKER_EXPORT.knownKeysStorageKey, JSON.stringify([...set]));
}

// --- Transport ---------------------------------------------------------

async function oncoCall(action, payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ONCOTRACKER_EXPORT.timeoutMs);
    try {
        // text/plain body keeps this a "simple" request: Apps Script needs no CORS preflight.
        const res = await fetch(ONCOTRACKER_EXPORT.apiUrl, {
            method: "POST",
            body: JSON.stringify({ action, payload: payload || {} }),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`OncoTracker server responded with ${res.status}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Unknown OncoTracker server error");
        return json.data;
    } catch (err) {
        if (err.name === "AbortError") throw new Error("OncoTracker server took too long to respond");
        if (err instanceof TypeError) throw new Error("Could not reach the OncoTracker server");
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// --- Build rows ---------------------------------------------------------

/** Excel rows -> candidate OncoTracker patients (deduplicated within the file itself). */
function oncoBuildCandidates(excelPatients) {
    const seen = new Set();
    const out = [];
    (excelPatients || []).forEach(pat => {
        const name = oncoCleanName(getPatientVal(pat, "name"));
        const fileNo = oncoNormMrn(oncoCleanText(getPatientVal(pat, "file")));
        const nationalId = oncoNormMrn(oncoCleanText(getPatientVal(pat, "id"))).replace(/^ID/, "");
        if (!name || (!fileNo && !nationalId)) return;
        const keys = oncoKeysFor(fileNo, nationalId);
        if (keys.some(k => seen.has(k))) return; // same patient appears twice in the Excel
        keys.forEach(k => seen.add(k));
        const plan = oncoCleanText(getPatientVal(pat, "treatmentPlan"));
        out.push({
            keys,
            row: {
                mrn: fileNo || "ID" + nationalId,
                nationalId,
                name,
                phone: oncoFixPhone(oncoCleanText(getPatientVal(pat, "mobile"))),
                physician: oncoCleanPhysician(oncoCleanText(getPatientVal(pat, "physician"))),
                diagnosis: oncoCleanText(getPatientVal(pat, "diagnosis")),
                notes: plan ? `Treatment plan: ${plan}` : ""
            }
        });
    });
    return out;
}

/** Stable row id per patient: two uploads racing each other upsert the same row instead of adding two. */
function oncoPatientIdFor(mrn) {
    return "P_cdb_" + mrn.replace(/[^0-9A-Z]/g, "");
}

// --- Main entry (called after an Excel upload) ---------------------------------------------------------

async function exportNewPatientsToOncoTracker(excelPatients, options = {}) {
    if (oncoExportInFlight) return { skipped: "in-flight" };
    const candidates = oncoBuildCandidates(excelPatients);
    if (candidates.length === 0) return { created: 0 };

    // Fast path: every patient in this Excel is already known to be in OncoTracker -> no network at all.
    const known = oncoReadKnownKeys();
    if (!options.force && candidates.every(c => c.keys.some(k => known.has(k)))) return { created: 0 };

    oncoExportInFlight = true;
    try {
        const data = await oncoCall("SYNC");
        const existing = (data && data.tables && data.tables.patients) || [];
        const existingKeys = new Set();
        // OncoTracker patients saved without any file number / ID can only be recognised by name.
        const namesWithoutNumber = new Set();
        existing.forEach(p => {
            const keys = oncoKeysFor(p.mrn, p.nationalId);
            keys.forEach(k => existingKeys.add(k));
            if (keys.length === 0 && p.name) namesWithoutNumber.add(oncoNormName(p.name));
        });

        const fresh = candidates.filter(c =>
            !c.keys.some(k => existingKeys.has(k)) && !namesWithoutNumber.has(oncoNormName(c.row.name)));
        const now = new Date().toISOString();

        if (fresh.length > 0) {
            const ops = fresh.map(c => ({
                op: "upsert",
                table: "patients",
                row: Object.assign({
                    id: oncoPatientIdFor(c.row.mrn),
                    phone2: "", age: "", gender: "", phoneFlag: "", ignoredIssues: "[]", mergedInto: "",
                    createdAt: now, updatedAt: now
                }, c.row)
            }));
            ops.push({
                op: "append",
                table: "activity",
                row: {
                    id: "A_cdb" + Date.now().toString(36),
                    at: now,
                    by: "OncoCoord (CDB)",
                    table: "", rowId: "", patientId: "",
                    action: "note",
                    summary: `Imported ${fresh.length} new patient${fresh.length === 1 ? "" : "s"} from OncoCoord Excel upload${options.fileName ? " (" + options.fileName + ")" : ""}`,
                    changes: "[]"
                }
            });
            for (let i = 0; i < ops.length; i += ONCOTRACKER_EXPORT.batchSize) {
                await oncoCall("APPLY", { ops: ops.slice(i, i + ONCOTRACKER_EXPORT.batchSize) });
            }
        }

        // Remember everything now confirmed in OncoTracker so the next upload can skip the network.
        existingKeys.forEach(k => known.add(k));
        fresh.forEach(c => c.keys.forEach(k => known.add(k)));
        oncoWriteKnownKeys(known);

        return { created: fresh.length, alreadyThere: candidates.length - fresh.length };
    } finally {
        oncoExportInFlight = false;
    }
}

/** Fire-and-forget wrapper used by the upload flow: reports the outcome as a toast, never blocks the dashboard. */
function runOncoTrackerExport(excelPatients, fileName) {
    exportNewPatientsToOncoTracker(excelPatients, { fileName })
        .then(result => {
            if (result && result.created > 0) {
                showToast(`OncoTracker: added ${result.created} new patient${result.created === 1 ? "" : "s"}.`, "success");
            }
        })
        .catch(err => {
            console.error("OncoTracker export failed:", err);
            showToast("OncoTracker export failed: " + err.message + ". It will retry on the next upload.", "error");
        });
}

/**
 * OncoTracker export — after every Excel upload, CDB data is copied into the
 * OncoTracker app (https://anwjawad.github.io/oncotracker/#/patients).
 *
 * 1) NEW patients are created in OncoTracker's Patients sheet from these columns only:
 *      Patient Name      -> name
 *      File Number       -> mrn            (if empty: "ID" + national ID, the OncoTracker convention)
 *      ID                -> nationalId     (extra column; the backend adds it to the sheet automatically)
 *      Diagnosis         -> diagnosis
 *      Patient Mobile    -> phone
 *      Primary Physician -> physician      ("Dr." prefix removed, as OncoTracker stores it)
 *      Treatment Plan    -> notes          (OncoTracker patients have no plan field)
 *    One copy per patient: a row is NOT created when OncoTracker already has a patient with the
 *    same File Number or the same ID (or, for OncoTracker patients saved without any number,
 *    the same name). Rows with neither a File Number nor an ID are skipped.
 *
 * 2) "CDB File": every patient (new or existing) also carries a snapshot of ALL its Excel
 *    columns in the `cdbData` column (JSON list of [column, value]), shown read-only in
 *    OncoTracker's patient drawer. For existing patients only `cdbData` / `cdbUpdatedAt` are
 *    written, and only when at least one column changed since the last upload. The patient's
 *    own OncoTracker fields (name, phone, doctor, ...) are never modified.
 *
 * Nothing is written when there are no new patients and no changed CDB data.
 * Talks to OncoTracker's Google Apps Script backend directly (actions SYNC and APPLY,
 * see oncotracker/backend/Code.gs). Never deletes anything.
 *
 * Reuses dashboard.js globals: getPatientVal, showToast.
 */

const ONCOTRACKER_EXPORT = Object.freeze({
    // Same deployment the OncoTracker app is built with (oncotracker/js/settings.js DEFAULT_API_URL).
    apiUrl: "https://script.google.com/macros/s/AKfycbwSNo0whdJGYjDDcIKsq-MVVIKeG6w47E1sDnIJkE6iQmHFIq-afFuVlikwqSG6OTWxJA/exec",
    batchSize: 250,
    timeoutMs: 60000,
    by: "OncoCoord (CDB)"
});

// processWorkbook stores some columns under a canonical KEY_MAP alias; show the Excel header instead.
const ONCO_CDB_LABELS = Object.freeze({ patient: "Patient Name" });

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

// --- CDB File snapshot ---------------------------------------------------------

/** All Excel columns of one row, in sheet order, as [label, value] pairs (empty Column_N fillers dropped). */
function oncoBuildCdbPairs(pat) {
    const pairs = [];
    Object.keys(pat || {}).forEach(key => {
        const value = String(pat[key] === undefined || pat[key] === null ? "" : pat[key]).trim();
        if (/^Column_\d+$/.test(key) && !value) return;
        pairs.push([ONCO_CDB_LABELS[key] || key, value]);
    });
    return pairs;
}

function oncoParseCdbPairs(json) {
    try {
        const parsed = JSON.parse(json || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

/** Column names whose value differs between two snapshots (added, removed or changed). */
function oncoChangedColumns(oldPairs, newPairs) {
    const before = new Map(oldPairs.map(([k, v]) => [k, v]));
    const after = new Map(newPairs.map(([k, v]) => [k, v]));
    const changed = [];
    new Set([...before.keys(), ...after.keys()]).forEach(k => {
        if ((before.get(k) || "") !== (after.get(k) || "")) changed.push(k);
    });
    return changed;
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
            cdbPairs: oncoBuildCdbPairs(pat),
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

function oncoActivityNote(summary, patientId, now, n) {
    return {
        op: "append",
        table: "activity",
        row: {
            id: "A_cdb" + Date.now().toString(36) + (n || 0).toString(36) + Math.random().toString(36).slice(2, 6),
            at: now,
            by: ONCOTRACKER_EXPORT.by,
            table: patientId ? "patients" : "", rowId: patientId || "", patientId: patientId || "",
            action: "note",
            summary,
            changes: "[]"
        }
    };
}

// --- Main entry (called after an Excel upload) ---------------------------------------------------------

async function exportNewPatientsToOncoTracker(excelPatients, options = {}) {
    if (oncoExportInFlight) return { skipped: "in-flight" };
    const candidates = oncoBuildCandidates(excelPatients);
    if (candidates.length === 0) return { created: 0, updated: 0 };

    oncoExportInFlight = true;
    try {
        // Read-only: what OncoTracker has right now.
        const data = await oncoCall("SYNC");
        const existing = (data && data.tables && data.tables.patients) || [];
        const byKey = new Map();
        const byNameWithoutNumber = new Map(); // patients saved without any number can only be matched by name
        existing.forEach(p => {
            const keys = oncoKeysFor(p.mrn, p.nationalId);
            keys.forEach(k => { if (!byKey.has(k)) byKey.set(k, p); });
            if (keys.length === 0 && p.name) byNameWithoutNumber.set(oncoNormName(p.name), p);
        });

        const now = new Date().toISOString();
        const ops = [];
        const notes = [];
        let created = 0;
        let updated = 0;

        candidates.forEach(c => {
            const match = c.keys.map(k => byKey.get(k)).find(Boolean) || byNameWithoutNumber.get(oncoNormName(c.row.name));
            const cdbData = JSON.stringify(c.cdbPairs);

            if (!match) {
                ops.push({
                    op: "upsert",
                    table: "patients",
                    row: Object.assign({
                        id: oncoPatientIdFor(c.row.mrn),
                        phone2: "", age: "", gender: "", phoneFlag: "", ignoredIssues: "[]", mergedInto: "",
                        createdAt: now, updatedAt: now,
                        cdbData, cdbUpdatedAt: now
                    }, c.row)
                });
                created++;
                return;
            }

            // Existing patient: only the CDB File snapshot, and only when something changed.
            if ((match.cdbData || "") === cdbData) return;
            const changed = oncoChangedColumns(oncoParseCdbPairs(match.cdbData), c.cdbPairs);
            if (match.cdbData && changed.length === 0) return; // same content, different serialisation
            ops.push({ op: "upsert", table: "patients", row: { id: match.id, cdbData, cdbUpdatedAt: now } });
            notes.push(oncoActivityNote(
                match.cdbData
                    ? `CDB file updated: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ` (+${changed.length - 8} more)` : ""}`
                    : "CDB file linked from OncoCoord",
                match.id, now, notes.length));
            updated++;
        });

        if (ops.length === 0) return { created: 0, updated: 0 };

        if (created > 0) {
            notes.push(oncoActivityNote(
                `Imported ${created} new patient${created === 1 ? "" : "s"} from OncoCoord Excel upload${options.fileName ? " (" + options.fileName + ")" : ""}`,
                "", now, notes.length));
        }
        const all = ops.concat(notes);
        for (let i = 0; i < all.length; i += ONCOTRACKER_EXPORT.batchSize) {
            await oncoCall("APPLY", { ops: all.slice(i, i + ONCOTRACKER_EXPORT.batchSize) });
        }
        return { created, updated };
    } finally {
        oncoExportInFlight = false;
    }
}

/** Fire-and-forget wrapper used by the upload flow: reports the outcome as a toast, never blocks the dashboard. */
function runOncoTrackerExport(excelPatients, fileName) {
    exportNewPatientsToOncoTracker(excelPatients, { fileName })
        .then(result => {
            if (!result) return;
            const parts = [];
            if (result.created > 0) parts.push(`added ${result.created} new patient${result.created === 1 ? "" : "s"}`);
            if (result.updated > 0) parts.push(`updated the CDB file of ${result.updated} patient${result.updated === 1 ? "" : "s"}`);
            if (parts.length) showToast(`OncoTracker: ${parts.join(", ")}.`, "success");
        })
        .catch(err => {
            console.error("OncoTracker export failed:", err);
            showToast("OncoTracker export failed: " + err.message + ". It will retry on the next upload.", "error");
        });
}

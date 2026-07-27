/**
 * NCM Sync Layer — talks to the Google Apps Script backend (see
 * google-apps-script/ncm-backend.gs). Pure networking + outbox
 * management; no DOM/rendering code lives here (that's ncm.js).
 *
 * Fill in NCM_CONFIG.apiUrl once the Phase A backend is deployed
 * (see google-apps-script/README.md). Until then, every sync call
 * fails gracefully and the app keeps working entirely on local data
 * — nothing here blocks local-only usage.
 */

const NCM_CONFIG = {
    apiUrl: "https://script.google.com/macros/s/AKfycbwYccSeAGeqUZRlP5Kqo3ZF4M1fKh0WEHYM_WEhnOqg8h83kMsmd_Dn9zFsDfXKkt6R/exec",
    token: "",           // must match the SHARED_TOKEN script property on the backend, if one is set (currently unset)
    pollIntervalMs: 15000
};

const NCM_SYNC_STORAGE_KEYS = Object.freeze({
    outbox: "ncm_outbox",
    lastPoll: "ncm_last_poll"
});

function ncmSyncIsConfigured() {
    return !!NCM_CONFIG.apiUrl;
}

// --- Outbox (pending mutations) ---------------------------------------------------------

function ncmReadOutbox() {
    const raw = readStorage(NCM_SYNC_STORAGE_KEYS.outbox);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn("Unable to parse NCM outbox, resetting.", err);
        return [];
    }
}

function ncmWriteOutbox(entries) {
    writeStorage(NCM_SYNC_STORAGE_KEYS.outbox, JSON.stringify(entries));
}

/**
 * Queue a mutation for background sync. `entry` shape:
 * { id, action, payload, createdAt, attempts }
 * Returns the queued entry (with a generated id).
 */
function ncmQueueMutation(action, payload) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action,
        payload,
        createdAt: new Date().toISOString(),
        attempts: 0
    };
    const outbox = ncmReadOutbox();
    outbox.push(entry);
    ncmWriteOutbox(outbox);
    return entry;
}

function ncmRemoveFromOutbox(entryId) {
    const outbox = ncmReadOutbox().filter(e => e.id !== entryId);
    ncmWriteOutbox(outbox);
}

function ncmPendingCountForPatient(patientKey) {
    return ncmReadOutbox().filter(e => e.payload && e.payload.patientKey === patientKey).length;
}

// --- Low-level request ---------------------------------------------------------

function ncmBuildGetUrl(action, extraParams) {
    const params = new URLSearchParams({ action, token: NCM_CONFIG.token, ...(extraParams || {}) });
    return `${NCM_CONFIG.apiUrl}?${params.toString()}`;
}

async function ncmGet(action, extraParams) {
    if (!ncmSyncIsConfigured()) return { success: false, error: "NCM backend not configured." };
    try {
        const res = await fetch(ncmBuildGetUrl(action, extraParams));
        return await res.json();
    } catch (err) {
        return { success: false, error: String(err && err.message ? err.message : err) };
    }
}

async function ncmPost(action, payload) {
    if (!ncmSyncIsConfigured()) return { success: false, error: "NCM backend not configured." };
    try {
        const body = JSON.stringify({ action, token: NCM_CONFIG.token, ...payload });
        const res = await fetch(NCM_CONFIG.apiUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight against Apps Script
            body
        });
        return await res.json();
    } catch (err) {
        return { success: false, error: String(err && err.message ? err.message : err) };
    }
}

// --- High-level API (mirrors ncm-backend.gs actions 1:1) ---------------------------------------------------------

function ncmApiList() { return ncmGet("list"); }
function ncmApiGet(patientKey) { return ncmGet("get", { patientKey }); }
function ncmApiChanges(since) { return ncmGet("changes", { since }); }
function ncmApiImport(patient, user, role) { return ncmPost("import", { patient, user, role }); }
function ncmApiCreateManual(patientKey, patient, user, role) { return ncmPost("createManual", { patientKey, patient, user, role }); }
function ncmApiLink(patientKey, patient, user, role) { return ncmPost("link", { patientKey, patient, user, role }); }
function ncmApiUpdateShared(patientKey, fields, user, role) { return ncmPost("updateShared", { patientKey, fields, user, role }); }
function ncmApiUpdateCoordinator(patientKey, fields, expectedVersion, user) {
    return ncmPost("updateCoordinator", { patientKey, fields, expectedVersion, user, role: "coordinator" });
}
function ncmApiUpdateResident(patientKey, fields, expectedVersion, user) {
    return ncmPost("updateResident", { patientKey, fields, expectedVersion, user, role: "resident" });
}

// --- Outbox processing ---------------------------------------------------------

let ncmOutboxProcessing = false;

/**
 * Drain the outbox, oldest first. Stops at the first failure for a given
 * patient so later mutations for that same patient don't race ahead of an
 * earlier one that hasn't landed yet; other patients' entries still proceed.
 * Calls onEntryResult(entry, result) for every attempt so the UI can update
 * per-patient sync status.
 */
async function ncmProcessOutbox(onEntryResult) {
    if (ncmOutboxProcessing || !ncmSyncIsConfigured()) return;
    ncmOutboxProcessing = true;
    try {
        const blockedPatients = new Set();
        let outbox = ncmReadOutbox();
        for (const entry of outbox) {
            const patientKey = entry.payload && entry.payload.patientKey;
            if (patientKey && blockedPatients.has(patientKey)) continue;

            entry.attempts = (entry.attempts || 0) + 1;
            ncmWriteOutbox(ncmReadOutbox().map(e => e.id === entry.id ? entry : e));

            const result = await ncmDispatchMutation_(entry);
            if (result && result.success) {
                ncmRemoveFromOutbox(entry.id);
            } else if (patientKey) {
                blockedPatients.add(patientKey);
            }
            if (onEntryResult) onEntryResult(entry, result);
        }
    } finally {
        ncmOutboxProcessing = false;
    }
}

function ncmDispatchMutation_(entry) {
    const p = entry.payload;
    switch (entry.action) {
        case "import": return ncmApiImport(p.patient, p.user, p.role);
        case "createManual": return ncmApiCreateManual(p.patientKey, p.patient, p.user, p.role);
        case "link": return ncmApiLink(p.patientKey, p.patient, p.user, p.role);
        case "updateShared": return ncmApiUpdateShared(p.patientKey, p.fields, p.user, p.role);
        case "updateCoordinator": return ncmApiUpdateCoordinator(p.patientKey, p.fields, p.expectedVersion, p.user);
        case "updateResident": return ncmApiUpdateResident(p.patientKey, p.fields, p.expectedVersion, p.user);
        default: return Promise.resolve({ success: false, error: `Unknown outbox action: ${entry.action}` });
    }
}

// --- Polling ---------------------------------------------------------

let ncmPollTimer = null;

function ncmStartPolling(onChanges) {
    if (ncmPollTimer) return;
    const poll = async () => {
        if (!ncmSyncIsConfigured()) return;
        const since = readStorage(NCM_SYNC_STORAGE_KEYS.lastPoll, "1970-01-01T00:00:00.000Z");
        const result = await ncmApiChanges(since);
        if (result && result.success) {
            writeStorage(NCM_SYNC_STORAGE_KEYS.lastPoll, result.serverTime || new Date().toISOString());
            if (result.data && result.data.length > 0 && onChanges) onChanges(result.data);
        }
        await ncmProcessOutbox(); // opportunistically retry pending mutations on every poll tick too
    };
    ncmPollTimer = setInterval(poll, NCM_CONFIG.pollIntervalMs);
    poll(); // fire immediately on start, don't wait a full interval
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") poll();
    });
}

function ncmStopPolling() {
    if (ncmPollTimer) {
        clearInterval(ncmPollTimer);
        ncmPollTimer = null;
    }
}

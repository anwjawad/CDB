/**
 * NCM Collaborative Workspace — client-side logic + rendering.
 *
 * Data flow: Master Excel data (patientsData, read-only source of truth)
 * -> "Import to NCM" -> local NCM store (localStorage, offline-first)
 * -> background sync to the Google Apps Script backend (ncm-sync.js).
 *
 * The Excel-imported patient in `patientsData` is NEVER modified by any
 * function in this file — NCM records are a separate overlay, linked by
 * `patientKey`, not a copy that replaces the original.
 *
 * Reuses dashboard.js globals: getPatientVal, normalizeValue, isEmptyLike,
 * escapeHTML, isPendingValue, isYesValue, isValidDateValue, readStorage,
 * writeStorage, showToast, patientsData.
 */

// --- Storage keys & local state ---------------------------------------------------------

const NCM_STORAGE_KEYS = Object.freeze({
    localData: "ncm_local_data",   // { [patientKey]: ncmRecord }
    currentUser: "ncm_current_user" // { name, role }
});

let ncmState = {
    selectedPatientKey: null,
    selectedListRole: "coordinator", // which list was clicked last, for context when opening the workspace
    activeWorkspaceTab: "coordinator", // 'coordinator' | 'compare'
    searchQuery: "",
    activeFilter: "all",
    draft: {},          // { [patientKey]: { coordinator: {...unsaved fields}, resident: {...}, shared: {...} } }
    syncStatus: {},      // { [patientKey]: 'synced' | 'pending' | 'saving' | 'conflict' | 'error' }
    conflict: null,      // { patientKey, role, local, server } when a conflict UI should show
    remoteNotice: null,  // { patientKey, text } "Updated by X • time" banner for the open patient
    // Resident Review tab (separate page, own selection/search/filter — see setupNcmWorkspace)
    residentView: { selectedPatientKey: null, searchQuery: "", activeFilter: "all" }
};

// --- Local NCM store ---------------------------------------------------------

function ncmReadLocalStore() {
    const raw = readStorage(NCM_STORAGE_KEYS.localData);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        console.warn("Unable to parse local NCM store, resetting.", err);
        return {};
    }
}

function ncmWriteLocalStore(store) {
    writeStorage(NCM_STORAGE_KEYS.localData, JSON.stringify(store));
}

function ncmGetAllLocalPatients() {
    const store = ncmReadLocalStore();
    return Object.keys(store).map(k => store[k]);
}

function ncmGetLocalPatient(patientKey) {
    return ncmReadLocalStore()[patientKey] || null;
}

function ncmUpsertLocalPatient(record) {
    const store = ncmReadLocalStore();
    store[record.patientKey] = record;
    ncmWriteLocalStore(store);
}

// --- Identity (must mirror ncm-backend.gs buildMasterPatientKey_ / normalizeKey_ exactly) ---------------------------------------------------------

function ncmNormalizeKey(value) {
    return String(value === undefined || value === null ? "" : value)
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function ncmBuildMasterPatientKey(patientId, patientFile, patientName) {
    const id = ncmNormalizeKey(patientId);
    const file = ncmNormalizeKey(patientFile);
    if (id || file) return `master:${id}|${file}`;
    return `master-name:${ncmNormalizeKey(patientName)}`;
}

function ncmGenerateManualKey() {
    if (window.crypto && window.crypto.randomUUID) return `manual-${window.crypto.randomUUID()}`;
    return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Current user / role (no real auth — see design doc) ---------------------------------------------------------

function ncmGetCurrentUser() {
    const raw = readStorage(NCM_STORAGE_KEYS.currentUser);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

function ncmSetCurrentUser(name, role) {
    writeStorage(NCM_STORAGE_KEYS.currentUser, JSON.stringify({ name, role }));
}

function ncmEnsureCurrentUser(callback) {
    const existing = ncmGetCurrentUser();
    if (existing && existing.name && existing.role) {
        callback(existing);
        return;
    }
    ncmShowUserPickerModal(callback);
}

function ncmShowUserPickerModal(callback) {
    const modal = document.getElementById("ncm-user-modal");
    if (!modal) { callback({ name: "Unknown", role: "coordinator" }); return; }
    modal.classList.remove("hidden");
    const nameInput = document.getElementById("ncm-user-name-input");
    const roleSelect = document.getElementById("ncm-user-role-select");
    const confirmBtn = document.getElementById("ncm-user-confirm-btn");
    nameInput.value = "";
    roleSelect.value = "coordinator";
    nameInput.focus();

    const onConfirm = () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const role = roleSelect.value;
        ncmSetCurrentUser(name, role);
        modal.classList.add("hidden");
        confirmBtn.removeEventListener("click", onConfirm);
        callback({ name, role });
    };
    confirmBtn.addEventListener("click", onConfirm);
}

// --- Import from Master Registry ---------------------------------------------------------

function ncmBuildSnapshotFromMasterPatient(pat) {
    return {
        patientName: getPatientVal(pat, "name"),
        patientFile: getPatientVal(pat, "file"),
        patientId: getPatientVal(pat, "id"),
        clinic: getPatientVal(pat, "clinic"),
        division: getPatientVal(pat, "division"),
        diagnosis: getPatientVal(pat, "diagnosis"),
        primaryPhysician: getPatientVal(pat, "physician"),
        referralType: getPatientVal(pat, "referralType"),
        referralForms: getPatientVal(pat, "referralForms"),
        treatmentReferralStatus: getPatientVal(pat, "treatmentReferralStatus"),
        otherReferralStatus: getPatientVal(pat, "otherReferralStatus"),
        permitSent: getPatientVal(pat, "permitSent"),
        permitStatus: getPatientVal(pat, "permitStatus"),
        clinicVisitDate: getPatientVal(pat, "visitDate"),
        chemoDate: getPatientVal(pat, "chemoDate"),
        otherAppointments: getPatientVal(pat, "otherAppt"),
        patientNotified: getPatientVal(pat, "notified"),
        patientNotifiedOther: getPatientVal(pat, "notifiedOther"),
        barrier: getPatientVal(pat, "barrier"),
        caseStatus: getPatientVal(pat, "status"),
        sharedTreatmentPlan: getPatientVal(pat, "treatmentPlan"),
        sharedNotes: getPatientVal(pat, "notes"),
        coordinatorBriefHistory: getPatientVal(pat, "diagnosis"),
        residentBriefHistory: getPatientVal(pat, "diagnosis"),
        coordinatorTreatmentPlan: getPatientVal(pat, "treatmentPlan"),
        residentTreatmentPlan: getPatientVal(pat, "treatmentPlan")
    };
}

function ncmEmptyRecord(patientKey, source, snapshot) {
    const now = new Date().toISOString();
    return Object.assign({
        patientKey,
        source,
        masterLinked: source === "master",
        coordinatorBriefHistory: "", coordinatorTreatmentPlan: "", coordinatorNotes: "",
        coordinatorMeetingNotes: "", coordinatorDecision: "", coordinatorStatus: "Not Started",
        coordinatorVersion: 0, coordinatorUpdatedAt: "", coordinatorUpdatedBy: "",
        residentBriefHistory: "", residentAssessment: "", residentTreatmentPlan: "", residentNotes: "",
        residentMeetingNotes: "", residentDecision: "", residentStatus: "Not Started",
        residentVersion: 0, residentUpdatedAt: "", residentUpdatedBy: "",
        createdAt: now, createdBy: "", updatedAt: now
    }, snapshot);
}

/**
 * Import a Master Registry patient into NCM. Idempotent: if already
 * present locally (or, once synced, on the server), opens the existing
 * record instead of creating a duplicate. Never modifies `pat`/`patientsData`.
 */
function ncmImportPatient(pat, user) {
    const patientId = getPatientVal(pat, "id");
    const patientFile = getPatientVal(pat, "file");
    const patientName = getPatientVal(pat, "name");
    const patientKey = ncmBuildMasterPatientKey(patientId, patientFile, patientName);

    const existing = ncmGetLocalPatient(patientKey);
    if (existing) {
        showToast(`${patientName} is already in NCM. Opening existing record.`, "info");
        return { patientKey, created: false };
    }

    const snapshot = ncmBuildSnapshotFromMasterPatient(pat);
    const record = ncmEmptyRecord(patientKey, "master", snapshot);
    record.createdBy = user ? user.name : "";
    ncmUpsertLocalPatient(record);
    ncmSetSyncStatus(patientKey, "pending");
    ncmQueueMutation("import", { patientKey, patient: snapshot, user: user ? user.name : "", role: user ? user.role : "" });
    showToast(`${patientName} imported to NCM.`, "success");
    ncmTriggerBackgroundSync();
    return { patientKey, created: true };
}

/**
 * Create an NCM-only patient not present in the Excel tracker.
 * Minimum fields only — does not force the full Excel schema.
 */
function ncmCreateManualPatient(fields, user) {
    if (!fields.patientName || !fields.patientName.trim()) {
        showToast("Patient name is required.", "error");
        return null;
    }
    const patientKey = ncmGenerateManualKey();
    const snapshot = {
        patientName: fields.patientName.trim(),
        patientFile: fields.patientFile || "",
        patientId: fields.patientId || "",
        primaryPhysician: fields.primaryPhysician || "",
        sharedTreatmentPlan: fields.treatmentPlan || "",
        sharedNotes: fields.notes || "",
        coordinatorBriefHistory: fields.briefHistory || ""
    };
    const record = ncmEmptyRecord(patientKey, "manual", snapshot);
    record.createdBy = user ? user.name : "";
    ncmUpsertLocalPatient(record);
    ncmSetSyncStatus(patientKey, "pending");
    ncmQueueMutation("createManual", {
        patientKey,
        patient: { patientName: snapshot.patientName, patientFile: snapshot.patientFile, patientId: snapshot.patientId, primaryPhysician: snapshot.primaryPhysician, treatmentPlan: snapshot.sharedTreatmentPlan, notes: snapshot.sharedNotes, briefHistory: snapshot.coordinatorBriefHistory },
        user: user ? user.name : "", role: user ? user.role : ""
    });
    showToast(`${snapshot.patientName} added to NCM (NCM Only).`, "success");
    ncmTriggerBackgroundSync();
    return patientKey;
}

/** Link a manual NCM-only patient to a Master Registry patient found later. patientKey never changes. */
function ncmLinkPatient(patientKey, masterPat, user) {
    const record = ncmGetLocalPatient(patientKey);
    if (!record) return;
    const patientId = getPatientVal(masterPat, "id");
    const patientFile = getPatientVal(masterPat, "file");
    record.masterLinked = true;
    record.patientId = patientId;
    record.patientFile = patientFile;
    record.updatedAt = new Date().toISOString();
    ncmUpsertLocalPatient(record);
    ncmSetSyncStatus(patientKey, "pending");
    ncmQueueMutation("link", { patientKey, patient: { patientId, patientFile }, user: user ? user.name : "", role: user ? user.role : "" });
    showToast("Patient linked to Master Registry.", "success");
    ncmTriggerBackgroundSync();
}

/** Does this NCM patientKey correspond to a patient already imported? Used to render "Import to NCM" vs "Open in NCM". */
function ncmFindExistingByMasterPatient(pat) {
    const patientKey = ncmBuildMasterPatientKey(getPatientVal(pat, "id"), getPatientVal(pat, "file"), getPatientVal(pat, "name"));
    return ncmGetLocalPatient(patientKey);
}

// --- Save lifecycle ---------------------------------------------------------

function ncmSetSyncStatus(patientKey, status) {
    ncmState.syncStatus[patientKey] = status;
    ncmUpdateSyncStatusUI(patientKey);
}

/** Lightweight in-place update of the sync indicator, avoiding a full re-render on every status tick. */
function ncmUpdateSyncStatusUI(patientKey) {
    if (ncmState.selectedPatientKey === patientKey) {
        const indicator = document.querySelector("#ncm-workspace-panel .ncm-sync-indicator");
        if (indicator) {
            const status = ncmGetSyncStatus(patientKey);
            indicator.className = `ncm-sync-indicator ncm-sync-${status}`;
            indicator.innerHTML = ncmSyncStatusLabel_(status);
        }
    }
    if (ncmState.residentView.selectedPatientKey === patientKey) {
        const indicator = document.querySelector("#ncm-resident-workspace-panel .ncm-sync-indicator");
        if (indicator) {
            const status = ncmGetSyncStatus(patientKey);
            indicator.className = `ncm-sync-indicator ncm-sync-${status}`;
            indicator.innerHTML = ncmSyncStatusLabel_(status);
        }
    }
    ncmRefreshListsIfVisible();
    ncmRefreshResidentListIfVisible();
}

function ncmGetSyncStatus(patientKey) {
    return ncmState.syncStatus[patientKey] || (ncmPendingCountForPatient(patientKey) > 0 ? "pending" : "synced");
}

/**
 * role: 'coordinator' | 'resident' | 'shared'
 * fields: partial object of the role's editable fields
 */
async function ncmSaveRoleFields(patientKey, role, fields, user) {
    const record = ncmGetLocalPatient(patientKey);
    if (!record) return;

    Object.assign(record, fields);
    record.updatedAt = new Date().toISOString();
    ncmUpsertLocalPatient(record);
    ncmSetSyncStatus(patientKey, "saving");

    if (role === "shared") {
        ncmQueueMutation("updateShared", { patientKey, fields, user: user.name, role: user.role });
    } else {
        const versionField = `${role}Version`;
        ncmQueueMutation(`update${role.charAt(0).toUpperCase()}${role.slice(1)}`, {
            patientKey, fields, expectedVersion: record[versionField], user: user.name
        });
    }

    await ncmTriggerBackgroundSync();
}

async function ncmTriggerBackgroundSync() {
    if (!ncmSyncIsConfigured()) {
        // No backend configured yet: local-only mode. Reflect that honestly instead of a false "Synced".
        Object.keys(ncmState.syncStatus).forEach(k => {
            if (ncmPendingCountForPatient(k) > 0) ncmSetSyncStatus(k, "pending");
        });
        return;
    }
    await ncmProcessOutbox((entry, result) => {
        const patientKey = entry.payload && entry.payload.patientKey;
        if (!patientKey) return;
        if (entry.action === "delete") {
            // Already removed locally at delete time — never resurrect it here, even on success.
            delete ncmState.syncStatus[patientKey];
            ncmRefreshListsIfVisible();
            return;
        }
        if (result && result.success) {
            const record = ncmGetLocalPatient(patientKey) || {};
            Object.assign(record, result.data);
            record.patientKey = patientKey; // in case the server payload lacks it on some responses
            ncmUpsertLocalPatient(record);
            ncmSetSyncStatus(patientKey, ncmPendingCountForPatient(patientKey) > 0 ? "pending" : "synced");
            ncmRefreshListsIfVisible();
            if (ncmState.selectedPatientKey === patientKey) ncmRenderWorkspacePanel();
            if (ncmState.residentView.selectedPatientKey === patientKey) ncmRenderResidentWorkspacePanel();
        } else if (result && result.conflict) {
            const role = entry.action === "updateResident" ? "resident" : "coordinator";
            ncmSetSyncStatus(patientKey, "conflict");
            ncmState.conflict = { patientKey, role, local: ncmGetLocalPatient(patientKey), server: result.server };
            if (ncmState.selectedPatientKey === patientKey) ncmRenderConflictBanner();
            if (ncmState.residentView.selectedPatientKey === patientKey) ncmRenderResidentConflictBanner();
        } else {
            ncmSetSyncStatus(patientKey, "pending"); // network/lock failure — will retry next poll tick
        }
    });
}

// --- Remote change merging (polling) ---------------------------------------------------------

function ncmMergeRemoteChanges(remoteRows) {
    const store = ncmReadLocalStore();
    remoteRows.forEach(remote => {
        const local = store[remote.patientKey];
        const isSelectedSomewhere = ncmState.selectedPatientKey === remote.patientKey || ncmState.residentView.selectedPatientKey === remote.patientKey;
        const isOpenWithUnsavedEdits = isSelectedSomewhere &&
            ncmState.draft[remote.patientKey] && Object.keys(ncmState.draft[remote.patientKey]).length > 0;

        if (!local) {
            store[remote.patientKey] = remote;
            return;
        }
        const remoteIsNewer = new Date(remote.updatedAt || 0).getTime() > new Date(local.updatedAt || 0).getTime();
        if (!remoteIsNewer) return;

        if (isOpenWithUnsavedEdits) {
            // Don't clobber what's being typed — just flag it, let the user decide.
            const user = ncmDescribeUpdater_(remote, local);
            ncmState.remoteNotice = { patientKey: remote.patientKey, text: user };
            return;
        }
        store[remote.patientKey] = remote;
        if (isSelectedSomewhere) {
            ncmState.remoteNotice = { patientKey: remote.patientKey, text: ncmDescribeUpdater_(remote, local) };
        }
    });
    ncmWriteLocalStore(store);
    ncmRefreshListsIfVisible();
    ncmRefreshResidentListIfVisible();
    if (ncmState.selectedPatientKey) ncmRenderRemoteNoticeBanner();
    if (ncmState.residentView.selectedPatientKey) ncmRenderResidentRemoteNoticeBanner();
}

function ncmDescribeUpdater_(remote, local) {
    const roleUpdated = new Date(remote.coordinatorUpdatedAt || 0) > new Date(local.coordinatorUpdatedAt || 0) ? "Coordinator" : "Resident";
    const who = roleUpdated === "Coordinator" ? remote.coordinatorUpdatedBy : remote.residentUpdatedBy;
    const time = new Date(remote.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Updated by ${escapeHTML(who || roleUpdated)} • ${time}`;
}

function ncmRefreshListsIfVisible() {
    const pane = document.getElementById("tab-ncm");
    if (pane && pane.classList.contains("active")) renderNcmTab();
}

function ncmRefreshResidentListIfVisible() {
    const pane = document.getElementById("tab-ncm-resident");
    if (pane && pane.classList.contains("active")) renderNcmResidentTab();
}

// --- Deterministic "Patient at a Glance" + auto-summary (no AI — rule-based, never hallucinates) ---------------------------------------------------------

function ncmGetAtAGlanceCards(record) {
    const cards = [];

    const refType = record.referralType || record.referralForms;
    if (isEmptyLike(refType)) {
        cards.push({ key: "referral", label: "Referral", state: "none", icon: "fa-file-circle-question", text: "None on file" });
    } else {
        const status = record.treatmentReferralStatus || record.otherReferralStatus;
        let state = "pending";
        if (isApprovedValue(status)) state = "ok";
        else if (isRejectedValue(status)) state = "danger";
        cards.push({ key: "referral", label: "Referral", state, icon: "fa-file-medical", text: `${refType}${status ? " — " + status : ""}` });
    }

    if (!isYesValue(record.permitSent)) {
        cards.push({ key: "permit", label: "Permit", state: "none", icon: "fa-passport", text: "Not requested" });
    } else {
        let state = "pending";
        if (isApprovedValue(record.permitStatus)) state = "ok";
        else if (isRejectedValue(record.permitStatus)) state = "danger";
        cards.push({ key: "permit", label: "Permit", state, icon: "fa-passport", text: record.permitStatus || "Pending" });
    }

    if (isValidDateValue(record.chemoDate)) {
        cards.push({ key: "chemo", label: "Chemotherapy", state: "ok", icon: "fa-syringe", text: record.chemoDate });
    } else {
        cards.push({ key: "chemo", label: "Chemotherapy", state: "pending", icon: "fa-syringe", text: "Not scheduled" });
    }

    cards.push({ key: "case", label: "Case", state: "info", icon: "fa-folder-open", text: record.caseStatus || "Not set" });

    if (!isEmptyLike(record.barrier) && !isNoValue(record.barrier)) {
        cards.push({ key: "barrier", label: "Barrier", state: "danger", icon: "fa-triangle-exclamation", text: record.barrier });
    } else {
        cards.push({ key: "barrier", label: "Barrier", state: "ok", icon: "fa-circle-check", text: "None documented" });
    }

    return cards;
}

function ncmBuildAutoSummary(record) {
    const sentences = [];

    let opening = "Oncology patient";
    if (record.primaryPhysician) opening += ` under ${record.primaryPhysician}`;
    if (record.diagnosis) opening += ` (${record.diagnosis})`;
    sentences.push(opening + ".");

    const refType = record.referralType || "";
    const refStatus = record.treatmentReferralStatus || record.otherReferralStatus;
    if (refStatus) {
        const prefix = refType ? `${refType} referral` : "Referral";
        if (isApprovedValue(refStatus)) sentences.push(`${prefix} approved.`);
        else if (isPendingValue(refStatus)) sentences.push(`${prefix} submitted, pending decision.`);
        else if (isRejectedValue(refStatus)) sentences.push(`${prefix} rejected.`);
        else sentences.push(`${prefix} status: ${refStatus}.`);
    }

    if (isYesValue(record.permitSent)) {
        if (isApprovedValue(record.permitStatus)) sentences.push("Permit approved.");
        else if (isEmptyLike(record.permitStatus) || isPendingValue(record.permitStatus)) sentences.push("Permit pending.");
        else sentences.push(`Permit status: ${record.permitStatus}.`);
    }

    if (isValidDateValue(record.chemoDate)) sentences.push(`Chemotherapy scheduled for ${record.chemoDate}.`);
    else sentences.push("Chemotherapy not yet scheduled.");

    if (!isEmptyLike(record.barrier) && !isNoValue(record.barrier)) {
        sentences.push(`Active coordination barrier: ${record.barrier}.`);
    } else {
        sentences.push("No active coordination barrier documented.");
    }

    return sentences.join(" ");
}

// --- Filters ---------------------------------------------------------

function ncmMatchesFilter(record, filter, listRole) {
    if (filter === "all") return true;
    if (filter === "ncm-only") return record.source === "manual";
    if (filter === "not-in-master") return !record.masterLinked;
    if (filter === "has-barrier") return !isEmptyLike(record.barrier) && !isNoValue(record.barrier);
    if (filter === "pending-referral") return isPendingValue(record.treatmentReferralStatus);
    if (filter === "pending-permit") return isYesValue(record.permitSent) && (isEmptyLike(record.permitStatus) || isPendingValue(record.permitStatus));
    if (filter === "chemo-not-scheduled") return !isValidDateValue(record.chemoDate);
    return true;
}

function ncmMatchesSearch(record, query) {
    if (!query) return true;
    const q = normalizeValue(query);
    return normalizeValue(record.patientName).includes(q) ||
        normalizeValue(record.patientFile).includes(q) ||
        normalizeValue(record.patientId).includes(q);
}

function ncmGetFilteredPatients(listRole) {
    return ncmGetAllLocalPatients()
        .filter(r => ncmMatchesSearch(r, ncmState.searchQuery))
        .filter(r => ncmMatchesFilter(r, ncmState.activeFilter, listRole))
        .sort((a, b) => (a.patientName || "").localeCompare(b.patientName || ""));
}

// --- Main tab render (entry point, called from setupTabSwitching) ---------------------------------------------------------

const NCM_FILTER_OPTIONS = [
    { key: "all", label: "All" },
    { key: "ncm-only", label: "NCM Only" },
    { key: "not-in-master", label: "Not in Master Registry" },
    { key: "has-barrier", label: "Has Barrier" },
    { key: "pending-referral", label: "Pending Referral" },
    { key: "pending-permit", label: "Pending Permit" },
    { key: "chemo-not-scheduled", label: "Chemo Not Scheduled" }
];


function renderNcmTab() {
    ncmRenderToolbar();
    ncmRenderList("coordinator");
    if (ncmState.selectedPatientKey) {
        ncmRenderWorkspacePanel();
    } else {
        ncmRenderEmptyWorkspace();
    }
}

function ncmRenderToolbar() {
    const chipsEl = document.getElementById("ncm-filter-chips");
    if (chipsEl && chipsEl.children.length === 0) {
        NCM_FILTER_OPTIONS.forEach(opt => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "ncm-filter-chip" + (opt.key === ncmState.activeFilter ? " active" : "");
            chip.textContent = opt.label;
            chip.dataset.filter = opt.key;
            chip.addEventListener("click", () => {
                ncmState.activeFilter = opt.key;
                chipsEl.querySelectorAll(".ncm-filter-chip").forEach(c => c.classList.toggle("active", c.dataset.filter === opt.key));
                ncmRenderList("coordinator");
            });
            chipsEl.appendChild(chip);
        });
    }
    const userChip = document.getElementById("ncm-current-user-chip");
    const user = ncmGetCurrentUser();
    if (userChip) userChip.textContent = user ? `${user.name} (${user.role === "coordinator" ? "Coordinator" : "Resident"})` : "";
}

function ncmRenderList(role) {
    const container = document.getElementById(`ncm-list-${role}`);
    const countEl = document.getElementById(`ncm-${role === "coordinator" ? "coord" : "resident"}-count`);
    if (!container) return;

    const patients = ncmGetFilteredPatients(role);
    if (countEl) countEl.textContent = patients.length;
    container.innerHTML = "";

    if (patients.length === 0) {
        container.innerHTML = `<div class="ncm-list-empty">No patients match this view.</div>`;
        return;
    }

    patients.forEach(record => {
        const item = document.createElement("div");
        item.className = "ncm-list-item" + (ncmState.selectedPatientKey === record.patientKey ? " selected" : "");
        const syncStatus = ncmGetSyncStatus(record.patientKey);
        item.innerHTML = `
            <div class="ncm-list-item-main">
                <span class="ncm-list-item-name">${escapeHTML(record.patientName || "Unnamed")}</span>
                ${!record.masterLinked ? '<span class="ncm-badge ncm-badge-warn">NCM Only</span>' : ''}
                ${syncStatus === "pending" || syncStatus === "saving" ? '<span class="ncm-sync-dot ncm-sync-pending" title="Pending sync"></span>' : ''}
                ${syncStatus === "conflict" ? '<span class="ncm-sync-dot ncm-sync-conflict" title="Conflict"></span>' : ''}
            </div>
            <div class="ncm-list-item-meta">${escapeHTML(record.patientFile || "-")} • ${escapeHTML(record.patientId || "-")}</div>
        `;
        item.addEventListener("click", () => ncmSelectPatient(record.patientKey, role));
        container.appendChild(item);
    });
}

function ncmSelectPatient(patientKey, listRole) {
    ncmState.selectedPatientKey = patientKey;
    ncmState.selectedListRole = listRole;
    ncmState.activeWorkspaceTab = listRole;
    ncmState.remoteNotice = null;
    ncmRenderList("coordinator");
    ncmRenderWorkspacePanel();
}

function ncmRenderEmptyWorkspace() {
    const panel = document.getElementById("ncm-workspace-panel");
    if (!panel) return;
    panel.innerHTML = `
        <div class="ncm-empty-state">
            <i class="fa-solid fa-user-doctor"></i>
            <h3>Select a patient</h3>
            <p>Choose a patient from the Coordinator or Resident list, or import/add one to get started.</p>
        </div>
    `;
}

// --- Patient workspace panel ---------------------------------------------------------

const NCM_COORDINATOR_FIELD_DEFS = [
    { key: "coordinatorBriefHistory", label: "Brief History", type: "textarea" },
    { key: "coordinatorTreatmentPlan", label: "Treatment Plan", type: "textarea" },
    { key: "coordinatorNotes", label: "Coordinator Notes", type: "textarea" }
];
const NCM_RESIDENT_FIELD_DEFS = [
    { key: "residentBriefHistory", label: "Brief History", type: "textarea" },
    { key: "residentTreatmentPlan", label: "Treatment Plan", type: "textarea" },
    { key: "residentNotes", label: "Resident Notes", type: "textarea" }
];
const NCM_SHARED_FIELD_DEFS = [
    { key: "sharedTreatmentPlan", label: "Shared Treatment Plan", type: "textarea" },
    { key: "sharedNotes", label: "Shared Notes", type: "textarea" },
    { key: "caseStatus", label: "Case Status", type: "text" },
    { key: "barrier", label: "Current Barrier / Issue", type: "text" }
];
const NCM_FULL_RECORD_GROUPS = [
    { title: "Patient", fields: [["patientName", "Name"], ["patientId", "ID"], ["patientFile", "File"], ["clinic", "Clinic"], ["division", "Division"], ["primaryPhysician", "Physician"]] },
    { title: "Clinical", fields: [["diagnosis", "Diagnosis"], ["sharedTreatmentPlan", "Treatment Plan"]] },
    { title: "Referral", fields: [["referralType", "Referral Type"], ["referralForms", "Referral Forms"], ["treatmentReferralStatus", "Treatment Referral Status"], ["otherReferralStatus", "Other Referral Status"]] },
    { title: "Permit", fields: [["permitSent", "Permit Sent"], ["permitStatus", "Permit Status"]] },
    { title: "Appointments", fields: [["clinicVisitDate", "Clinic Visit"], ["chemoDate", "Chemotherapy Appointment"], ["otherAppointments", "Other Appointments"]] },
    { title: "Communication", fields: [["patientNotified", "Patient Notified"], ["patientNotifiedOther", "Other Appt Notification"]] },
    { title: "Coordination", fields: [["barrier", "Barrier / Issue"], ["sharedNotes", "Notes"], ["caseStatus", "Case Status"]] }
];

function ncmSyncStatusLabel_(status) {
    if (status === "saving") return '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving locally...';
    if (status === "pending") return '<i class="fa-solid fa-cloud-arrow-up"></i> Pending Sync';
    if (status === "conflict") return '<i class="fa-solid fa-triangle-exclamation"></i> Conflict';
    if (status === "synced") return '<i class="fa-solid fa-check"></i> Synced';
    return '<i class="fa-solid fa-circle"></i> Local only';
}

function ncmRenderWorkspacePanel() {
    const panel = document.getElementById("ncm-workspace-panel");
    if (!panel) return;
    const record = ncmGetLocalPatient(ncmState.selectedPatientKey);
    if (!record) { ncmState.selectedPatientKey = null; ncmRenderEmptyWorkspace(); return; }

    const cards = ncmGetAtAGlanceCards(record);
    const summary = ncmBuildAutoSummary(record);
    const syncStatus = ncmGetSyncStatus(record.patientKey);

    panel.innerHTML = `
        <div class="ncm-workspace-header">
            <div class="ncm-workspace-header-nav">
                <button class="btn btn-secondary btn-sm" id="ncm-prev-btn" title="Previous patient (Alt+Left)"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="btn btn-secondary btn-sm" id="ncm-next-btn" title="Next patient (Alt+Right)"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="ncm-workspace-identity">
                <h2>${escapeHTML(record.patientName || "Unnamed")}</h2>
                <div class="ncm-identity-row">
                    <span>File ${escapeHTML(record.patientFile || "-")} &bull; ID ${escapeHTML(record.patientId || "-")}</span>
                    ${record.diagnosis ? `<span class="ncm-identity-sep">&bull;</span><span>${escapeHTML(record.diagnosis)}</span>` : ""}
                    ${record.primaryPhysician ? `<span class="ncm-identity-sep">&bull;</span><span>${escapeHTML(record.primaryPhysician)}</span>` : ""}
                </div>
                <div class="ncm-identity-badges">
                    ${!record.masterLinked ? '<span class="ncm-badge ncm-badge-warn">NCM Only (Not in Master Registry)</span>' : ""}
                    <span class="ncm-sync-indicator ncm-sync-${syncStatus}">${ncmSyncStatusLabel_(syncStatus)}</span>
                </div>
            </div>
            ${!record.masterLinked ? `<button class="btn btn-secondary btn-sm" id="ncm-link-btn"><i class="fa-solid fa-link"></i> Link to Master Registry</button>` : ""}
            <button class="btn btn-secondary btn-sm ncm-delete-btn" id="ncm-delete-btn" title="Remove from NCM"><i class="fa-solid fa-trash-can"></i></button>
        </div>

        <div id="ncm-remote-notice-banner"></div>
        <div id="ncm-conflict-banner"></div>

        <div class="ncm-at-a-glance">
            <h4>Patient at a Glance</h4>
            <div class="ncm-glance-grid">
                ${cards.map(c => `
                    <div class="ncm-glance-card ncm-glance-${c.state}">
                        <div class="ncm-glance-icon"><i class="fa-solid ${c.icon}"></i></div>
                        <div class="ncm-glance-body">
                            <span class="ncm-glance-label">${c.label}</span>
                            <span class="ncm-glance-text">${escapeHTML(String(c.text))}</span>
                        </div>
                    </div>
                `).join("")}
            </div>
        </div>

        <div class="ncm-auto-summary">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <p>${escapeHTML(summary)}</p>
        </div>

        <div class="ncm-shared-section">
            <h4>Shared Information</h4>
            <div class="ncm-field-grid" id="ncm-shared-fields"></div>
        </div>

        <div class="ncm-role-tabs">
            <button class="ncm-role-tab ${ncmState.activeWorkspaceTab === "coordinator" ? "active" : ""}" data-tab="coordinator">Coordinator</button>
            <button class="ncm-role-tab ${ncmState.activeWorkspaceTab === "compare" ? "active" : ""}" data-tab="compare">Compare (read-only)</button>
        </div>
        <div class="ncm-role-panel" id="ncm-role-panel"></div>

        <details class="ncm-full-record">
            <summary>Full Patient Record</summary>
            <div id="ncm-full-record-body"></div>
        </details>

        <div class="ncm-history-panel">
            <h4>History</h4>
            <ul>
                <li>Created ${record.createdAt ? new Date(record.createdAt).toLocaleString() : "-"} ${record.createdBy ? "by " + escapeHTML(record.createdBy) : ""}</li>
                <li>Coordinator last updated: ${record.coordinatorUpdatedAt ? new Date(record.coordinatorUpdatedAt).toLocaleString() + (record.coordinatorUpdatedBy ? " by " + escapeHTML(record.coordinatorUpdatedBy) : "") : "Never"}</li>
                <li>Resident last updated: ${record.residentUpdatedAt ? new Date(record.residentUpdatedAt).toLocaleString() + (record.residentUpdatedBy ? " by " + escapeHTML(record.residentUpdatedBy) : "") : "Never"}</li>
            </ul>
        </div>
    `;

    ncmRenderSharedFields(record);
    ncmRenderRolePanel(record);
    ncmRenderFullRecord(record);
    ncmRenderRemoteNoticeBanner();
    ncmRenderConflictBanner();
    ncmWireWorkspaceHeaderButtons(record);
}

function ncmTrackDraft(patientKey, role, field, value) {
    if (!ncmState.draft[patientKey]) ncmState.draft[patientKey] = {};
    if (!ncmState.draft[patientKey][role]) ncmState.draft[patientKey][role] = {};
    ncmState.draft[patientKey][role][field] = value;
}

function ncmRenderSharedFields(record) {
    const container = document.getElementById("ncm-shared-fields");
    if (!container) return;
    container.innerHTML = NCM_SHARED_FIELD_DEFS.map(def => `
        <div class="ncm-field">
            <label>${def.label}</label>
            ${def.type === "textarea"
                ? `<textarea data-field="${def.key}" rows="2">${escapeHTML(record[def.key] || "")}</textarea>`
                : `<input type="text" data-field="${def.key}" value="${escapeHTML(record[def.key] || "")}">`}
        </div>
    `).join("") + `<button class="btn btn-primary btn-sm" id="ncm-save-shared-btn"><i class="fa-solid fa-floppy-disk"></i> Save Shared Info</button>`;

    container.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("input", () => ncmTrackDraft(record.patientKey, "shared", el.dataset.field, el.value));
    });
    const saveBtn = document.getElementById("ncm-save-shared-btn");
    if (saveBtn) saveBtn.addEventListener("click", () => ncmHandleSave(record.patientKey, "shared"));
}

function ncmRenderRolePanel(record) {
    const panel = document.getElementById("ncm-role-panel");
    if (!panel) return;
    document.querySelectorAll(".ncm-role-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            ncmState.activeWorkspaceTab = tab.dataset.tab;
            ncmRenderWorkspacePanel();
        });
    });

    panel.className = "ncm-role-panel role-" + ncmState.activeWorkspaceTab;

    if (ncmState.activeWorkspaceTab === "compare") {
        panel.innerHTML = ncmBuildCompareHtml_(record);
        return;
    }

    const role = ncmState.activeWorkspaceTab;
    const defs = role === "coordinator" ? NCM_COORDINATOR_FIELD_DEFS : NCM_RESIDENT_FIELD_DEFS;
    panel.innerHTML = `
        <div class="ncm-role-panel-heading"><i class="fa-solid ${role === "coordinator" ? "fa-user-nurse" : "fa-user-doctor"}"></i> ${role === "coordinator" ? "Coordinator Workspace" : "Resident Workspace"}</div>
        <div class="ncm-field-grid">
            ${defs.map(def => `
                <div class="ncm-field">
                    <label>${def.label}</label>
                    ${def.type === "select"
                        ? `<select data-field="${def.key}">${def.options.map(o => `<option value="${o}" ${record[def.key] === o ? "selected" : ""}>${o}</option>`).join("")}</select>`
                        : def.type === "textarea"
                        ? `<textarea data-field="${def.key}" rows="3">${escapeHTML(record[def.key] || "")}</textarea>`
                        : `<input type="text" data-field="${def.key}" value="${escapeHTML(record[def.key] || "")}">`}
                </div>
            `).join("")}
        </div>
        <div class="ncm-role-panel-footer">
            <button class="btn btn-primary btn-sm" id="ncm-save-role-btn"><i class="fa-solid fa-floppy-disk"></i> Save ${role === "coordinator" ? "Coordinator" : "Resident"} (Ctrl+S)</button>
            <span class="ncm-role-version">v${record[role + "Version"] || 0}</span>
        </div>
    `;
    panel.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("input", () => ncmTrackDraft(record.patientKey, role, el.dataset.field, el.value));
        el.addEventListener("change", () => ncmTrackDraft(record.patientKey, role, el.dataset.field, el.value));
    });
    const saveBtn = document.getElementById("ncm-save-role-btn");
    if (saveBtn) saveBtn.addEventListener("click", () => ncmHandleSave(record.patientKey, role));
}

function ncmBuildCompareHtml_(record) {
    const rows = [
        ["Brief History", record.coordinatorBriefHistory, record.residentBriefHistory],
        ["Treatment Plan", record.coordinatorTreatmentPlan, record.residentTreatmentPlan],
        ["Notes", record.coordinatorNotes, record.residentNotes]
    ];
    return `
        <div class="ncm-compare-grid">
            <div class="ncm-compare-col-header role-coordinator"><i class="fa-solid fa-user-nurse"></i> Coordinator</div>
            <div class="ncm-compare-col-header role-resident"><i class="fa-solid fa-user-doctor"></i> Resident</div>
            ${rows.map(([label, left, right]) => `
                <div class="ncm-compare-cell role-coordinator"><span class="ncm-compare-label">${label}</span><p class="${left !== right ? "ncm-compare-diff" : ""}">${escapeHTML(left || "&mdash;")}</p></div>
                <div class="ncm-compare-cell role-resident"><span class="ncm-compare-label">${label}</span><p class="${left !== right ? "ncm-compare-diff" : ""}">${escapeHTML(right || "&mdash;")}</p></div>
            `).join("")}
        </div>
    `;
}

function ncmRenderFullRecord(record) {
    const container = document.getElementById("ncm-full-record-body");
    if (!container) return;
    container.innerHTML = NCM_FULL_RECORD_GROUPS.map(group => `
        <div class="ncm-record-group">
            <h5>${group.title}</h5>
            <div class="ncm-record-group-grid">
                ${group.fields.map(([key, label]) => `
                    <div class="ncm-record-field">
                        <span class="ncm-record-field-label">${label}</span>
                        <span class="ncm-record-field-value">${escapeHTML(record[key] || "-")}</span>
                    </div>
                `).join("")}
            </div>
        </div>
    `).join("");
}

function ncmBuildRemoteNoticeHtml_(notice) {
    return `
        <div class="ncm-notice-banner">
            <i class="fa-solid fa-bell"></i> ${escapeHTML(notice.text)}
            <button class="btn btn-secondary btn-sm" data-dismiss-notice>Dismiss</button>
        </div>
    `;
}

function ncmRenderRemoteNoticeBanner() {
    const el = document.getElementById("ncm-remote-notice-banner");
    if (!el) return;
    const notice = ncmState.remoteNotice;
    if (!notice || notice.patientKey !== ncmState.selectedPatientKey) { el.innerHTML = ""; return; }
    el.innerHTML = ncmBuildRemoteNoticeHtml_(notice);
    el.querySelector("[data-dismiss-notice]").addEventListener("click", () => { ncmState.remoteNotice = null; ncmRenderWorkspacePanel(); });
}

function ncmRenderResidentRemoteNoticeBanner() {
    const el = document.getElementById("ncm-resident-remote-notice-banner");
    if (!el) return;
    const notice = ncmState.remoteNotice;
    if (!notice || notice.patientKey !== ncmState.residentView.selectedPatientKey) { el.innerHTML = ""; return; }
    el.innerHTML = ncmBuildRemoteNoticeHtml_(notice);
    el.querySelector("[data-dismiss-notice]").addEventListener("click", () => { ncmState.remoteNotice = null; ncmRenderResidentWorkspacePanel(); });
}

function ncmBuildConflictBannerHtml_(conflict) {
    return `
        <div class="ncm-conflict-banner">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <div>
                <strong>Save conflict.</strong> Someone else saved this patient's ${conflict.role} section first. Your changes were NOT overwritten, but were not saved either.
                <div class="ncm-conflict-actions">
                    <button class="btn btn-secondary btn-sm" data-conflict-action="reload">Reload Server Version</button>
                    <button class="btn btn-primary btn-sm" data-conflict-action="keep">Keep My Changes (Save as New Version)</button>
                </div>
            </div>
        </div>
    `;
}

function ncmWireConflictBannerActions_(el, conflict, onResolved) {
    el.querySelector('[data-conflict-action="reload"]').addEventListener("click", () => {
        const store = ncmReadLocalStore();
        store[conflict.patientKey] = conflict.server;
        ncmWriteLocalStore(store);
        ncmState.conflict = null;
        ncmSetSyncStatus(conflict.patientKey, "synced");
        onResolved();
        showToast("Loaded latest server version.", "info");
    });
    el.querySelector('[data-conflict-action="keep"]').addEventListener("click", () => {
        const record = ncmGetLocalPatient(conflict.patientKey);
        const role = conflict.role;
        const versionField = `${role}Version`;
        record[versionField] = conflict.server[versionField];
        ncmUpsertLocalPatient(record);
        ncmState.conflict = null;
        ncmEnsureCurrentUser((user) => {
            const fields = {};
            (role === "coordinator" ? NCM_COORDINATOR_FIELD_DEFS : NCM_RESIDENT_FIELD_DEFS).forEach(def => { fields[def.key] = record[def.key]; });
            ncmSaveRoleFields(conflict.patientKey, role, fields, user).then(onResolved);
        });
    });
}

function ncmRenderConflictBanner() {
    const el = document.getElementById("ncm-conflict-banner");
    if (!el) return;
    const conflict = ncmState.conflict;
    if (!conflict || conflict.patientKey !== ncmState.selectedPatientKey) { el.innerHTML = ""; return; }
    el.innerHTML = ncmBuildConflictBannerHtml_(conflict);
    ncmWireConflictBannerActions_(el, conflict, ncmRenderWorkspacePanel);
}

function ncmRenderResidentConflictBanner() {
    const el = document.getElementById("ncm-resident-conflict-banner");
    if (!el) return;
    const conflict = ncmState.conflict;
    if (!conflict || conflict.patientKey !== ncmState.residentView.selectedPatientKey) { el.innerHTML = ""; return; }
    el.innerHTML = ncmBuildConflictBannerHtml_(conflict);
    ncmWireConflictBannerActions_(el, conflict, ncmRenderResidentWorkspacePanel);
}

function ncmWireWorkspaceHeaderButtons(record) {
    const prevBtn = document.getElementById("ncm-prev-btn");
    const nextBtn = document.getElementById("ncm-next-btn");
    const linkBtn = document.getElementById("ncm-link-btn");
    const deleteBtn = document.getElementById("ncm-delete-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => ncmNavigate(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => ncmNavigate(1));
    if (linkBtn) linkBtn.addEventListener("click", () => ncmOpenLinkPicker(record));
    if (deleteBtn) deleteBtn.addEventListener("click", () => {
        if (window.confirm(`Remove ${record.patientName || "this patient"} from the NCM list? This cannot be undone.`)) {
            ncmDeletePatient(record.patientKey);
        }
    });
}

function ncmDeletePatient(patientKey) {
    const store = ncmReadLocalStore();
    if (!store[patientKey]) return;
    delete store[patientKey];
    ncmWriteLocalStore(store);

    const remainingOutbox = ncmReadOutbox().filter(e => !(e.payload && e.payload.patientKey === patientKey));
    ncmWriteOutbox(remainingOutbox);

    delete ncmState.draft[patientKey];
    delete ncmState.syncStatus[patientKey];
    if (ncmState.selectedPatientKey === patientKey) {
        ncmState.selectedPatientKey = null;
        ncmRenderEmptyWorkspace();
    }
    if (ncmState.residentView.selectedPatientKey === patientKey) {
        ncmState.residentView.selectedPatientKey = null;
        ncmRenderResidentEmptyWorkspace();
    }

    const user = ncmGetCurrentUser();
    ncmQueueMutation("delete", { patientKey, user: user ? user.name : "", role: user ? user.role : "" });
    ncmTriggerBackgroundSync();

    ncmRenderList("coordinator");
    ncmRenderResidentList();
    showToast("Patient removed from NCM.", "success");
}

function ncmNavigate(direction) {
    const list = ncmGetFilteredPatients(ncmState.selectedListRole);
    const idx = list.findIndex(p => p.patientKey === ncmState.selectedPatientKey);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    ncmSelectPatient(list[nextIdx].patientKey, ncmState.selectedListRole);
}

function ncmNavigateResident(direction) {
    const list = ncmGetResidentFilteredPatients();
    const idx = list.findIndex(p => p.patientKey === ncmState.residentView.selectedPatientKey);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    ncmSelectResidentPatient(list[nextIdx].patientKey);
}

async function ncmHandleSave(patientKey, role) {
    const draftForRole = (ncmState.draft[patientKey] && ncmState.draft[patientKey][role]) || {};
    if (Object.keys(draftForRole).length === 0) {
        showToast("No changes to save.", "info");
        return;
    }
    ncmEnsureCurrentUser(async (user) => {
        showToast("Saving locally...", "info");
        await ncmSaveRoleFields(patientKey, role, draftForRole, user);
        if (ncmState.draft[patientKey]) delete ncmState.draft[patientKey][role];
        showToast("Saved locally. Syncing...", "success");
        if (ncmState.selectedPatientKey === patientKey) ncmRenderWorkspacePanel();
        if (ncmState.residentView.selectedPatientKey === patientKey) ncmRenderResidentWorkspacePanel();
    });
}

// --- Resident Review tab (separate page — NCM-only data, no Excel/master fields) ---------------------------------------------------------

function ncmGetResidentFilteredPatients() {
    return ncmGetAllLocalPatients()
        .filter(r => ncmMatchesSearch(r, ncmState.residentView.searchQuery))
        .sort((a, b) => (a.patientName || "").localeCompare(b.patientName || ""));
}

function renderNcmResidentTab() {
    ncmRenderResidentToolbar();
    ncmRenderResidentList();
    if (ncmState.residentView.selectedPatientKey) {
        ncmRenderResidentWorkspacePanel();
    } else {
        ncmRenderResidentEmptyWorkspace();
    }
}

function ncmRenderResidentToolbar() {
    const userChip = document.getElementById("ncm-resident-current-user-chip");
    const user = ncmGetCurrentUser();
    if (userChip) userChip.textContent = user ? `${user.name} (${user.role === "coordinator" ? "Coordinator" : "Resident"})` : "";
}

function ncmRenderResidentList() {
    const container = document.getElementById("ncm-list-resident-only");
    const countEl = document.getElementById("ncm-resident-only-count");
    if (!container) return;

    const patients = ncmGetResidentFilteredPatients();
    if (countEl) countEl.textContent = patients.length;
    container.innerHTML = "";

    if (patients.length === 0) {
        container.innerHTML = `<div class="ncm-list-empty">No patients match this view.</div>`;
        return;
    }

    patients.forEach(record => {
        const item = document.createElement("div");
        item.className = "ncm-list-item" + (ncmState.residentView.selectedPatientKey === record.patientKey ? " selected" : "");
        const syncStatus = ncmGetSyncStatus(record.patientKey);
        item.innerHTML = `
            <div class="ncm-list-item-main">
                <span class="ncm-list-item-name">${escapeHTML(record.patientName || "Unnamed")}</span>
                ${syncStatus === "pending" || syncStatus === "saving" ? '<span class="ncm-sync-dot ncm-sync-pending" title="Pending sync"></span>' : ''}
                ${syncStatus === "conflict" ? '<span class="ncm-sync-dot ncm-sync-conflict" title="Conflict"></span>' : ''}
            </div>
            <div class="ncm-list-item-meta">${escapeHTML(record.patientFile || "-")} • ${escapeHTML(record.patientId || "-")}</div>
        `;
        item.addEventListener("click", () => ncmSelectResidentPatient(record.patientKey));
        container.appendChild(item);
    });
}

function ncmSelectResidentPatient(patientKey) {
    ncmState.residentView.selectedPatientKey = patientKey;
    ncmRenderResidentList();
    ncmRenderResidentWorkspacePanel();
}

function ncmRenderResidentEmptyWorkspace() {
    const panel = document.getElementById("ncm-resident-workspace-panel");
    if (!panel) return;
    panel.innerHTML = `
        <div class="ncm-empty-state">
            <i class="fa-solid fa-user-doctor"></i>
            <h3>Select a patient</h3>
            <p>Choose a patient from the list to review and edit your NCM notes.</p>
        </div>
    `;
}

function ncmRenderResidentWorkspacePanel() {
    const panel = document.getElementById("ncm-resident-workspace-panel");
    if (!panel) return;
    const record = ncmGetLocalPatient(ncmState.residentView.selectedPatientKey);
    if (!record) { ncmState.residentView.selectedPatientKey = null; ncmRenderResidentEmptyWorkspace(); return; }
    const syncStatus = ncmGetSyncStatus(record.patientKey);

    panel.innerHTML = `
        <div class="ncm-workspace-header">
            <div class="ncm-workspace-header-nav">
                <button class="btn btn-secondary btn-sm" id="ncm-resident-prev-btn" title="Previous patient (Alt+Left)"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="btn btn-secondary btn-sm" id="ncm-resident-next-btn" title="Next patient (Alt+Right)"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="ncm-workspace-identity">
                <h2>${escapeHTML(record.patientName || "Unnamed")}</h2>
                <div class="ncm-identity-row">
                    <span>File ${escapeHTML(record.patientFile || "-")} &bull; ID ${escapeHTML(record.patientId || "-")}</span>
                    ${record.diagnosis ? `<span class="ncm-identity-sep">&bull;</span><span>${escapeHTML(record.diagnosis)}</span>` : ""}
                </div>
                <div class="ncm-identity-badges">
                    <span class="ncm-sync-indicator ncm-sync-${syncStatus}">${ncmSyncStatusLabel_(syncStatus)}</span>
                </div>
            </div>
        </div>

        <div id="ncm-resident-remote-notice-banner"></div>
        <div id="ncm-resident-conflict-banner"></div>

        <div class="ncm-role-panel role-resident">
            <div class="ncm-role-panel-heading"><i class="fa-solid fa-user-doctor"></i> Resident Workspace</div>
            <div class="ncm-field-grid">
                ${NCM_RESIDENT_FIELD_DEFS.map(def => `
                    <div class="ncm-field">
                        <label>${def.label}</label>
                        ${def.type === "select"
                            ? `<select data-field="${def.key}">${def.options.map(o => `<option value="${o}" ${record[def.key] === o ? "selected" : ""}>${o}</option>`).join("")}</select>`
                            : def.type === "textarea"
                            ? `<textarea data-field="${def.key}" rows="3">${escapeHTML(record[def.key] || "")}</textarea>`
                            : `<input type="text" data-field="${def.key}" value="${escapeHTML(record[def.key] || "")}">`}
                    </div>
                `).join("")}
            </div>
            <div class="ncm-role-panel-footer">
                <button class="btn btn-primary btn-sm" id="ncm-resident-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save (Ctrl+S)</button>
                <span class="ncm-role-version">v${record.residentVersion || 0}</span>
            </div>
        </div>
    `;

    panel.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("input", () => ncmTrackDraft(record.patientKey, "resident", el.dataset.field, el.value));
        el.addEventListener("change", () => ncmTrackDraft(record.patientKey, "resident", el.dataset.field, el.value));
    });
    const saveBtn = document.getElementById("ncm-resident-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", () => ncmHandleSave(record.patientKey, "resident"));
    const prevBtn = document.getElementById("ncm-resident-prev-btn");
    const nextBtn = document.getElementById("ncm-resident-next-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => ncmNavigateResident(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => ncmNavigateResident(1));

    ncmRenderResidentRemoteNoticeBanner();
    ncmRenderResidentConflictBanner();
}

// --- Add Patient modal ---------------------------------------------------------

/** Populates the Add Patient modal's physician <select> from distinct physician names in the imported Excel data. */
function ncmPopulatePhysicianDropdown() {
    const select = document.getElementById("ncm-add-physician");
    if (!select) return;
    const names = new Set();
    (typeof patientsData !== "undefined" ? patientsData : []).forEach(pat => {
        const name = getPatientVal(pat, "physician");
        if (!isEmptyLike(name)) names.add(name);
    });
    const sorted = [...names].sort((a, b) => a.localeCompare(b));

    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select physician...";
    select.appendChild(placeholder);
    sorted.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    const otherOpt = document.createElement("option");
    otherOpt.value = "__other__";
    otherOpt.textContent = "Other (type manually)";
    select.appendChild(otherOpt);
}

function ncmOpenAddPatientModal() {
    const modal = document.getElementById("ncm-add-patient-modal");
    if (!modal) return;
    ["ncm-add-name", "ncm-add-file", "ncm-add-id", "ncm-add-history", "ncm-add-plan", "ncm-add-notes"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    ncmPopulatePhysicianDropdown();
    const otherInput = document.getElementById("ncm-add-physician-other");
    if (otherInput) { otherInput.value = ""; otherInput.style.display = "none"; }
    modal.classList.remove("hidden");
    document.getElementById("ncm-add-name").focus();
}

function ncmCloseAddPatientModal() {
    const modal = document.getElementById("ncm-add-patient-modal");
    if (modal) modal.classList.add("hidden");
}

function ncmSubmitAddPatientForm() {
    const physicianSelect = document.getElementById("ncm-add-physician").value;
    const physicianOther = document.getElementById("ncm-add-physician-other").value.trim();
    const primaryPhysician = physicianSelect === "__other__" ? physicianOther : physicianSelect;

    const fields = {
        patientName: document.getElementById("ncm-add-name").value,
        patientFile: document.getElementById("ncm-add-file").value,
        patientId: document.getElementById("ncm-add-id").value,
        primaryPhysician,
        briefHistory: document.getElementById("ncm-add-history").value,
        treatmentPlan: document.getElementById("ncm-add-plan").value,
        notes: document.getElementById("ncm-add-notes").value
    };
    ncmEnsureCurrentUser((user) => {
        const key = ncmCreateManualPatient(fields, user);
        if (key) {
            ncmCloseAddPatientModal();
            renderNcmTab();
            ncmSelectPatient(key, user.role);
        }
    });
}

// --- Link-to-Master modal ---------------------------------------------------------

function ncmOpenLinkPicker(record) {
    const modal = document.getElementById("ncm-link-modal");
    if (!modal) return;
    modal.dataset.patientKey = record.patientKey;
    const input = document.getElementById("ncm-link-search-input");
    input.value = "";
    ncmRenderLinkResults("");
    modal.classList.remove("hidden");
    input.focus();
}

function ncmCloseLinkModal() {
    const modal = document.getElementById("ncm-link-modal");
    if (modal) modal.classList.add("hidden");
}

function ncmRenderLinkResults(query) {
    const container = document.getElementById("ncm-link-results");
    if (!container) return;
    const q = normalizeValue(query);
    const matches = q.length === 0 ? [] : patientsData.filter(pat => {
        return normalizeValue(getPatientVal(pat, "name")).includes(q) ||
            normalizeValue(getPatientVal(pat, "id")).includes(q) ||
            normalizeValue(getPatientVal(pat, "file")).includes(q);
    }).slice(0, 8);

    if (matches.length === 0) {
        container.innerHTML = `<div class="ncm-list-empty">${q ? "No matches." : "Type a name, ID, or file number to search."}</div>`;
        return;
    }
    container.innerHTML = matches.map((pat, i) => `
        <div class="ncm-link-result" data-idx="${i}">
            <strong>${getEscapedPatientVal(pat, "name")}</strong>
            <span>${getEscapedPatientVal(pat, "file", "-")} &bull; ${getEscapedPatientVal(pat, "id", "-")}</span>
        </div>
    `).join("");
    container.querySelectorAll(".ncm-link-result").forEach((el, i) => {
        el.addEventListener("click", () => {
            const modal = document.getElementById("ncm-link-modal");
            const patientKey = modal.dataset.patientKey;
            ncmEnsureCurrentUser((user) => {
                ncmLinkPatient(patientKey, matches[i], user);
                ncmCloseLinkModal();
                ncmRenderWorkspacePanel();
            });
        });
    });
}

// --- Import entry points (called from Master Registry / Patient Details drawer) ---------------------------------------------------------

function ncmHandleImportClick(pat) {
    ncmEnsureCurrentUser((user) => {
        const existing = ncmFindExistingByMasterPatient(pat);
        if (!existing) ncmImportPatient(pat, user);
        const patientKey = ncmBuildMasterPatientKey(getPatientVal(pat, "id"), getPatientVal(pat, "file"), getPatientVal(pat, "name"));
        ncmGoToNcmTabAndOpen(patientKey, user.role);
    });
}

function ncmGoToNcmTabAndOpen(patientKey, role) {
    const navBtn = document.querySelector('.nav-item[data-tab="ncm"]');
    if (navBtn) navBtn.click();
    ncmSelectPatient(patientKey, role || "coordinator");
}

// --- Print / Word export: today's NCM discussion list ---------------------------------------------------------

/** "Today" = the local date the patient was ADDED to NCM (createdAt), NOT the clinic visit date. */
function ncmGetTodaysPatients() {
    const todayKey = getTodayDateKey();
    return ncmGetAllLocalPatients()
        .filter(r => r.createdAt && r.createdAt.slice(0, 10) === todayKey)
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

const NCM_DOC_STYLE = `
    @page { size: portrait; margin: 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; background: #ffffff; margin: 0; padding: 0; font-size: 10.5pt; line-height: 1.5; }
    .ncm-doc-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 18px; }
    .ncm-doc-header h1 { font-size: 18pt; color: #1e3a8a; margin: 0 0 4px 0; }
    .ncm-doc-header p { margin: 0; font-size: 10pt; color: #555555; }
    .ncm-doc-patient { border: 1px solid #cccccc; border-radius: 4px; padding: 10px 14px; margin-bottom: 14px; page-break-inside: avoid; }
    .ncm-doc-identity { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .ncm-doc-num { width: 26px; height: 26px; background: #1e3a8a; color: #ffffff; border-radius: 50%; text-align: center; vertical-align: middle; font-weight: 700; font-size: 10pt; }
    .ncm-doc-name { font-size: 13pt; font-weight: 700; color: #111827; }
    .ncm-doc-badge { display: inline-block; font-size: 8pt; font-weight: 700; color: #92400e; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 10px; padding: 1px 8px; margin-left: 8px; vertical-align: middle; }
    .ncm-doc-meta { font-size: 9.5pt; color: #555555; margin-top: 2px; }
    .ncm-doc-compare { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .ncm-doc-compare th { background: #f3f4f6; color: #1f2937; font-size: 9.5pt; padding: 5px 8px; border: 1px solid #dddddd; text-align: left; width: 50%; }
    .ncm-doc-compare td { border: 1px solid #dddddd; padding: 6px 8px; font-size: 9.5pt; vertical-align: top; width: 50%; }
    .ncm-doc-shared { width: 100%; border-collapse: collapse; margin-top: 8px; background: #f9fafb; }
    .ncm-doc-shared td { padding: 5px 8px; font-size: 9.5pt; border-top: 1px dashed #dddddd; }
    .ncm-doc-footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #dddddd; font-size: 8pt; color: #777777; display: flex; justify-content: space-between; }
`;

function ncmBuildTodaysListContentHtml_(patients) {
    const todayDisplay = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    let body = "";
    patients.forEach((r, idx) => {
        const hasShared = r.sharedTreatmentPlan || r.sharedNotes || r.caseStatus || r.barrier;
        body += `
        <div class="ncm-doc-patient">
            <table class="ncm-doc-identity">
                <tr>
                    <td class="ncm-doc-num">${idx + 1}</td>
                    <td>
                        <div class="ncm-doc-name">${escapeHTML(r.patientName || "Unnamed")}${!r.masterLinked ? ' <span class="ncm-doc-badge">NCM Only</span>' : ""}</div>
                        <div class="ncm-doc-meta">File ${escapeHTML(r.patientFile || "-")} &bull; ID ${escapeHTML(r.patientId || "-")}${r.diagnosis ? " &bull; " + escapeHTML(r.diagnosis) : ""}${r.primaryPhysician ? " &bull; " + escapeHTML(r.primaryPhysician) : ""}</div>
                    </td>
                </tr>
            </table>
            <table class="ncm-doc-compare">
                <thead><tr><th>Coordinator</th><th>Resident</th></tr></thead>
                <tbody>
                    <tr><td>${escapeHTML(r.coordinatorBriefHistory || "-")}</td><td>${escapeHTML(r.residentBriefHistory || "-")}</td></tr>
                    <tr><td><strong>Treatment Plan:</strong> ${escapeHTML(r.coordinatorTreatmentPlan || "-")}</td><td><strong>Treatment Plan:</strong> ${escapeHTML(r.residentTreatmentPlan || "-")}</td></tr>
                    <tr><td><strong>Notes:</strong> ${escapeHTML(r.coordinatorNotes || "-")}</td><td><strong>Notes:</strong> ${escapeHTML(r.residentNotes || "-")}</td></tr>
                </tbody>
            </table>
            ${hasShared ? `
            <table class="ncm-doc-shared">
                <tr><td><strong>Shared Treatment Plan:</strong> ${escapeHTML(r.sharedTreatmentPlan || "-")}</td></tr>
                <tr><td><strong>Shared Notes:</strong> ${escapeHTML(r.sharedNotes || "-")}</td></tr>
                <tr><td><strong>Case Status:</strong> ${escapeHTML(r.caseStatus || "-")}${r.barrier ? "&nbsp;&nbsp;&nbsp;<strong>Barrier:</strong> " + escapeHTML(r.barrier) : ""}</td></tr>
            </table>` : ""}
        </div>`;
    });

    return `
        <div class="ncm-doc-header">
            <h1>New Cases Meeting &mdash; Today's Discussion List</h1>
            <p>${todayDisplay} &bull; ${patients.length} patient${patients.length !== 1 ? "s" : ""} discussed</p>
        </div>
        ${body}`;
}

function ncmPrintTodaysList() {
    const patients = ncmGetTodaysPatients();
    if (patients.length === 0) {
        showToast("No patients discussed today yet.", "info");
        return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        showToast("Error: Popup blocked! Please allow popups for this site.", "error");
        return;
    }
    const content = ncmBuildTodaysListContentHtml_(patients);
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>NCM Today's List</title>
        <style>${NCM_DOC_STYLE}</style>
    </head>
    <body>
        ${content}
        <div class="ncm-doc-footer">
            <span>OncoCoord &mdash; NCM Collaborative Workspace</span>
            <span>Printed ${new Date().toLocaleString()}</span>
        </div>
        <script>
            window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
            };
        <\/script>
    </body>
    </html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
}

function ncmExportTodaysListToWord() {
    const patients = ncmGetTodaysPatients();
    if (patients.length === 0) {
        showToast("No patients discussed today yet.", "info");
        return;
    }
    const content = ncmBuildTodaysListContentHtml_(patients);
    const html = `<!DOCTYPE html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
        <meta charset="UTF-8">
        <title>NCM Today's List</title>
        <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
        <style>${NCM_DOC_STYLE}</style>
    </head>
    <body>
        ${content}
        <div class="ncm-doc-footer">
            <span>OncoCoord &mdash; NCM Collaborative Workspace</span>
            <span>Exported ${new Date().toLocaleString()}</span>
        </div>
    </body>
    </html>`;

    const blob = new Blob(["﻿", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `NCM_Today_${getTodayDateKey()}.doc`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${patients.length} patient${patients.length !== 1 ? "s" : ""} to Word.`, "success");
}

// --- Setup (called once from initApp) ---------------------------------------------------------

function setupNcmWorkspace() {
    document.addEventListener("keydown", (e) => {
        const coordPane = document.getElementById("tab-ncm");
        const residentPane = document.getElementById("tab-ncm-resident");
        const inCoordTab = coordPane && coordPane.classList.contains("active");
        const inResidentTab = residentPane && residentPane.classList.contains("active");
        if (!inCoordTab && !inResidentTab) return;

        if (inCoordTab) {
            if (!ncmState.selectedPatientKey) return;
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                const role = ncmState.activeWorkspaceTab === "compare" ? "shared" : ncmState.activeWorkspaceTab;
                ncmHandleSave(ncmState.selectedPatientKey, role);
            } else if (e.altKey && e.key === "ArrowLeft") {
                e.preventDefault();
                ncmNavigate(-1);
            } else if (e.altKey && e.key === "ArrowRight") {
                e.preventDefault();
                ncmNavigate(1);
            }
        } else if (inResidentTab) {
            if (!ncmState.residentView.selectedPatientKey) return;
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                ncmHandleSave(ncmState.residentView.selectedPatientKey, "resident");
            } else if (e.altKey && e.key === "ArrowLeft") {
                e.preventDefault();
                ncmNavigateResident(-1);
            } else if (e.altKey && e.key === "ArrowRight") {
                e.preventDefault();
                ncmNavigateResident(1);
            }
        }
    });

    const searchInput = document.getElementById("ncm-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            ncmState.searchQuery = searchInput.value;
            ncmRenderList("coordinator");
        });
    }

    const residentSearchInput = document.getElementById("ncm-resident-search-input");
    if (residentSearchInput) {
        residentSearchInput.addEventListener("input", () => {
            ncmState.residentView.searchQuery = residentSearchInput.value;
            ncmRenderResidentList();
        });
    }

    const printTodayBtn = document.getElementById("ncm-print-today-btn");
    if (printTodayBtn) printTodayBtn.addEventListener("click", ncmPrintTodaysList);
    const exportWordBtn = document.getElementById("ncm-export-word-btn");
    if (exportWordBtn) exportWordBtn.addEventListener("click", ncmExportTodaysListToWord);

    const addBtn = document.getElementById("ncm-add-patient-btn");
    if (addBtn) addBtn.addEventListener("click", ncmOpenAddPatientModal);
    const physicianSelect = document.getElementById("ncm-add-physician");
    if (physicianSelect) {
        physicianSelect.addEventListener("change", () => {
            const otherInput = document.getElementById("ncm-add-physician-other");
            if (otherInput) {
                otherInput.style.display = physicianSelect.value === "__other__" ? "" : "none";
                if (physicianSelect.value === "__other__") otherInput.focus();
            }
        });
    }
    const addCancelBtn = document.getElementById("ncm-add-cancel-btn");
    if (addCancelBtn) addCancelBtn.addEventListener("click", ncmCloseAddPatientModal);
    const addCloseBtn = document.getElementById("ncm-add-close-btn");
    if (addCloseBtn) addCloseBtn.addEventListener("click", ncmCloseAddPatientModal);
    const addSubmitBtn = document.getElementById("ncm-add-submit-btn");
    if (addSubmitBtn) addSubmitBtn.addEventListener("click", ncmSubmitAddPatientForm);

    const linkSearchInput = document.getElementById("ncm-link-search-input");
    if (linkSearchInput) linkSearchInput.addEventListener("input", () => ncmRenderLinkResults(linkSearchInput.value));
    const linkCancelBtn = document.getElementById("ncm-link-cancel-btn");
    if (linkCancelBtn) linkCancelBtn.addEventListener("click", ncmCloseLinkModal);
    const linkCloseBtn = document.getElementById("ncm-link-close-btn");
    if (linkCloseBtn) linkCloseBtn.addEventListener("click", ncmCloseLinkModal);

    ncmStartPolling(ncmMergeRemoteChanges);
}

// --- Global State ---
let patientsData = [];
let dropdownLists = {};
let filteredPatients = [];
let charts = {};
let currentSort = { column: 'Patient Name', direction: 'asc' };
let pagination = { currentPage: 1, pageSize: 25 };
let currentQuickFilters = new Set();
let activeColumnFilters = [];
const EMPTY_COLUMN_FILTER_VALUE = "__EMPTY__";
const EMPTY_COLUMN_FILTER_LABEL = "Empty / No data";

// --- App Configuration & Shared Utilities ---
const STORAGE_KEYS = Object.freeze({
    theme: "theme",
    data: "dashboard_static_data"
});

// --- F-01 hardening: patient health information (PHI) must never persist
// indefinitely in localStorage, where any later user of the same browser
// profile (or any script on the page) could read it. Sensitive keys are routed
// to sessionStorage so their data is automatically discarded when the browser
// tab/window is closed. Non-sensitive UI preferences (e.g. theme) stay in
// localStorage so they still persist across sessions.
const SENSITIVE_KEYS = Object.freeze(new Set([STORAGE_KEYS.data]));

// Idle auto-purge: wipe cached PHI after this many milliseconds of inactivity.
const PHI_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

function getStore(key) {
    return SENSITIVE_KEYS.has(key) ? window.sessionStorage : window.localStorage;
}

const VALUE_ALIASES = Object.freeze({
    yes: ["yes", "y", "true", "1", "نعم"],
    no: ["no", "n", "false", "0", "0.0", "none", "لا"],
    pending: ["pending", "on hold", "قيد الانتظار", "معلق"],
    approved: ["approved", "active", "yes", "completed", "complete", "نعم", "موافق عليه", "تم التنسيق"],
    rejected: ["rejected", "closed", "no", "لا", "مرفوض", "ملغي"],
    treatment: ["treatment", "علاج"]
});

function normalizeValue(value) {
    return String(value === undefined || value === null ? "" : value)
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function isEmptyLike(value) {
    const normalized = normalizeValue(value);
    return !normalized || normalized === "0" || normalized === "0.0" || normalized === "none" || normalized === "n/a" || normalized === "na";
}

function valueMatches(value, aliasGroup) {
    const aliases = VALUE_ALIASES[aliasGroup] || [];
    return aliases.includes(normalizeValue(value));
}

function isYesValue(value) { return valueMatches(value, "yes"); }
function isNoValue(value) { return valueMatches(value, "no") || isEmptyLike(value); }
function isPendingValue(value) { return valueMatches(value, "pending"); }
function isApprovedValue(value) { return valueMatches(value, "approved"); }
function isRejectedValue(value) { return valueMatches(value, "rejected"); }
function isTreatmentValue(value) { return valueMatches(value, "treatment"); }
function isValidDateValue(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()); }

function escapeHTML(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getEscapedPatientVal(pat, type, fallback = "") {
    const value = getPatientVal(pat, type);
    return escapeHTML(value || fallback);
}

function readStorage(key, fallback = null) {
    try {
        return getStore(key).getItem(key) ?? fallback;
    } catch (err) {
        console.warn(`Unable to read storage key "${key}"`, err);
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        getStore(key).setItem(key, value);
        return true;
    } catch (err) {
        console.error(`Unable to write storage key "${key}"`, err);
        showToast("Browser storage is unavailable or full. Data was not cached.", "error");
        return false;
    }
}

function removeStorage(key) {
    try {
        getStore(key).removeItem(key);
        return true;
    } catch (err) {
        console.warn(`Unable to remove storage key "${key}"`, err);
        return false;
    }
}

function ensureRuntimeDependencies() {
    const missing = [];
    if (typeof Chart === "undefined") missing.push("Chart.js");
    if (typeof XLSX === "undefined") missing.push("SheetJS");
    if (missing.length > 0) {
        showToast(`Missing browser libraries: ${missing.join(", ")}. Check the network connection and reload.`, "error");
        return false;
    }
    return true;
}

// --- Key Mapping Configuration for Excel Headers ---
const KEY_MAP = {
    name: ['patient', 'Patient Name', 'PatientName', 'اسم المريض'],
    id: ['ID', 'Id', 'الهوية', 'رقم الهوية', ' ID'],
    file: ['File Number', 'FileNumber', 'رقم الملف'],
    clinic: ['Clinic', 'العيادة'],
    visitDate: ['Date of clinic visit', 'تاريخ زيارة العيادة'],
    division: ['Division', 'القسم'],
    diagnosis: ['Diagnosis', 'التشخيص'],
    coordinator: ['Coordinator/ Clinic Nurse Signature', 'Coordinator/ Clinic Nurse', 'Coordinator', 'المنسق'],
    mobile: ['Patient Mobile', 'رقم الهاتف'],
    physician: ['Primary Physician', 'الطبيب المعالج'],
    referralType: ["Type patient's referral"],
    referralForms: ['Referral forms sent/types'],
    permitSent: ['Permit form sent'],
    otherAppt: ['Other Appointments and date', 'Other Appointment date'],
    guidance: ['Patient Guidance Completed'],
    treatmentPlan: ['Treatment Plan'],
    ncm: ['New Cases Meeting'],
    ncmDecision: ['New Cases Meeting decision'],
    treatmentReferralStatus: ['Treatment Referral Status'],
    otherReferralStatus: ['Other Referral Status'],
    permitStatus: ['Permit Status'],
    chemoDate: ['chemotherapy Appointment Date'],
    notified: ['Patient Notified'],
    notifiedOther: ['Patient Notified of other appointments'],
    barrier: ['Current Barrier/Issue', 'Current Barrier / Issue'],
    notes: ['Notes'],
    status: ['Case Status', 'Status', 'حالة الملف']
};

function getPatientVal(pat, type) {
    const keys = KEY_MAP[type];
    if (!keys) return "";
    // Exact match first
    for (const key of keys) {
        if (pat[key] !== undefined && pat[key] !== null) {
            return pat[key].toString().trim();
        }
    }
    // Normalized fallback: handles Unicode variants, casing, and invisible whitespace
    const normalizedAliases = keys.map(k => normalizeValue(k));
    for (const patKey of Object.keys(pat)) {
        if (patKey.startsWith('__')) continue;
        const normalizedPatKey = normalizeValue(patKey);
        const aliasIdx = normalizedAliases.indexOf(normalizedPatKey);
        if (aliasIdx !== -1) {
            const v = pat[patKey];
            if (v !== undefined && v !== null) return v.toString().trim();
        }
    }
    return "";
}

function hasActiveBarrier(pat) {
    const barrier = getPatientVal(pat, 'barrier').trim();
    return !isEmptyLike(barrier) && !isNoValue(barrier);
}

function updateMasterFunnel() {
    let registered = patientsData.length;
    let pending = 0;
    let ncmCount = 0;
    let permitCount = 0;
    let chemoScheduled = 0;

    patientsData.forEach(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase().trim();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase().trim();
        const permitSent = getPatientVal(pat, 'permitSent').toLowerCase().trim();
        const chemo = getPatientVal(pat, 'chemoDate').trim();

        if (isPendingValue(refStatus)) pending++;
        if (isYesValue(ncm)) ncmCount++;
        if (isYesValue(permitSent)) permitCount++;
        if (isValidDateValue(chemo)) chemoScheduled++;
    });

    const elRegistered = document.getElementById("funnel-val-registered");
    const elPending = document.getElementById("funnel-val-pending");
    const elNcm = document.getElementById("funnel-val-ncm");
    const elPermit = document.getElementById("funnel-val-permit");
    const elChemo = document.getElementById("funnel-val-chemo");

    if (elRegistered) elRegistered.innerText = registered;
    if (elPending) elPending.innerText = pending;
    if (elNcm) elNcm.innerText = ncmCount;
    if (elPermit) elPermit.innerText = permitCount;
    if (elChemo) elChemo.innerText = chemoScheduled;
}

function getTimelineSteps(pat) {
    const visitDate = getPatientVal(pat, 'visitDate').trim();
    const refStatusRaw = getPatientVal(pat, 'treatmentReferralStatus').trim();
    
    const ncmFlagRaw = getPatientVal(pat, 'ncm').trim();
    const ncmDecision = getPatientVal(pat, 'ncmDecision').trim();
    
    const permitSentRaw = getPatientVal(pat, 'permitSent').trim();
    const permitStatusRaw = getPatientVal(pat, 'permitStatus').trim();
    
    const chemoDate = getPatientVal(pat, 'chemoDate').trim();
    const isChemoScheduled = isValidDateValue(chemoDate);
    
    const notifiedRaw = getPatientVal(pat, 'notified').trim();

    // 1. Clinic Visit
    let step1 = { key: "V", title: "Clinic Visit", desc: "Patient visit record", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (visitDate) {
        step1.state = "completed";
        step1.desc = `Visited on ${visitDate}`;
        step1.icon = '<i class="fa-solid fa-circle-check"></i>';
    } else {
        step1.state = "pending";
        step1.desc = "Awaiting clinic visit registration";
        step1.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    // 2. Referral Submitted
    let step2 = { key: "R", title: "Referral Submitted", desc: "Treatment referral submitted to coordinator", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (refStatusRaw) {
        if (isPendingValue(refStatusRaw)) {
            step2.state = "pending";
            step2.desc = "Referral submitted, pending review";
            step2.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        } else if (isApprovedValue(refStatusRaw)) {
            step2.state = "completed";
            step2.desc = `Referral approved (${refStatusRaw})`;
            step2.icon = '<i class="fa-solid fa-circle-check"></i>';
        } else if (isRejectedValue(refStatusRaw)) {
            step2.state = "error";
            step2.desc = `Referral rejected (${refStatusRaw})`;
            step2.icon = '<i class="fa-solid fa-circle-xmark"></i>';
        } else {
            step2.state = "completed";
            step2.desc = `Status: ${refStatusRaw}`;
            step2.icon = '<i class="fa-solid fa-circle-check"></i>';
        }
    } else {
        if (step1.state === "completed") {
            step2.state = "pending";
            step2.desc = "Awaiting referral status entry";
            step2.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
    }

    // 3. NCM Review
    let step3 = { key: "N", title: "NCM Review", desc: "New Cases Meeting review status", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (isYesValue(ncmFlagRaw)) {
        if (ncmDecision) {
            step3.state = "completed";
            step3.desc = `Decision: ${ncmDecision}`;
            step3.icon = '<i class="fa-solid fa-circle-check"></i>';
        } else {
            step3.state = "pending";
            step3.desc = "Awaiting meeting review and decision";
            step3.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
    } else {
        step3.state = "skipped";
        step3.desc = "Not flagged for NCM review";
        step3.icon = '<i class="fa-solid fa-ban"></i>';
    }

    // 4. Permit Stage
    let step4 = { key: "P", title: "Permit Stage", desc: "Treatment permit clearance", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (isYesValue(permitSentRaw)) {
        if (isApprovedValue(permitStatusRaw)) {
            step4.state = "completed";
            step4.desc = `Permit approved: ${permitStatusRaw}`;
            step4.icon = '<i class="fa-solid fa-circle-check"></i>';
        } else if (isRejectedValue(permitStatusRaw)) {
            step4.state = "error";
            step4.desc = `Permit rejected: ${permitStatusRaw}`;
            step4.icon = '<i class="fa-solid fa-circle-xmark"></i>';
        } else {
            step4.state = "pending";
            step4.desc = `Permit sent, status: ${permitStatusRaw || 'Pending'}`;
            step4.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
    } else {
        step4.state = "skipped";
        step4.desc = "No permit request required";
        step4.icon = '<i class="fa-solid fa-ban"></i>';
    }

    // 5. Chemo Scheduled
    let step5 = { key: "C", title: "Chemo Scheduled", desc: "Chemotherapy appointment date", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (isChemoScheduled) {
        step5.state = "completed";
        step5.desc = `Scheduled for ${chemoDate}`;
        step5.icon = '<i class="fa-solid fa-circle-check"></i>';
    } else {
        const isPriorStepDone = step2.state === "completed" && (step3.state === "completed" || step3.state === "skipped") && (step4.state === "completed" || step4.state === "skipped");
        if (isPriorStepDone) {
            step5.state = "pending";
            step5.desc = "Awaiting chemo appointment scheduling";
            step5.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        } else {
            step5.desc = "Awaiting prior coordination clearances";
        }
    }

    // 6. Patient Notified
    let step6 = { key: "B", title: "Patient Notified", desc: "Patient informed of chemo appointment", state: "inactive", icon: '<i class="fa-solid fa-ellipsis"></i>' };
    if (isYesValue(notifiedRaw)) {
        step6.state = "completed";
        step6.desc = "Patient notified successfully";
        step6.icon = '<i class="fa-solid fa-circle-check"></i>';
    } else {
        if (isChemoScheduled) {
            step6.state = "pending";
            step6.desc = "Notification pending (requires follow-up)";
            step6.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        } else {
            step6.desc = "Awaiting chemo schedule first";
        }
    }

    return [step1, step2, step3, step4, step5, step6];
}

function getPatientNameHTML(pat) {
    const name = getPatientVal(pat, 'name');
    if (hasActiveBarrier(pat)) {
        return `
            <div class="name-wrapper">
                <span class="barrier-pulse-badge" title="Active Barrier: ${getEscapedPatientVal(pat, 'barrier')}"></span>
                <strong>${escapeHTML(name)}</strong>
            </div>
        `;
    }
    return `<strong>${escapeHTML(name)}</strong>`;
}

function generateMiniTimelineHTML(pat) {
    const steps = getTimelineSteps(pat);
    let html = `<div class="mini-timeline-container"><div class="mini-timeline">`;
    steps.forEach((step, idx) => {
        if (idx > 0) {
            html += `<div class="mini-connector"></div>`;
        }
        html += `<div class="mini-step ${step.state}" title="${step.title}: ${step.desc}">${step.key}</div>`;
    });
    html += `</div></div>`;
    return html;
}

function renderPatientTimeline(pat) {
    const timelineEl = document.getElementById("drawer-patient-timeline");
    if (!timelineEl) return;
    
    timelineEl.innerHTML = "";
    const steps = getTimelineSteps(pat);
    
    steps.forEach(step => {
        const stepDiv = document.createElement("div");
        stepDiv.className = `timeline-step ${step.state}`;
        
        stepDiv.innerHTML = `
            <div class="timeline-node">${step.icon}</div>
            <div class="timeline-content">
                <div class="timeline-title">${step.title}</div>
                <div class="timeline-desc">${step.desc}</div>
            </div>
        `;
        
        timelineEl.appendChild(stepDiv);
    });
}

function switchToMasterTab() {
    const masterTabBtn = document.querySelector(".nav-item[data-tab='master']");
    if (masterTabBtn) {
        masterTabBtn.click();
    }
}

function syncQuickFilterButtons() {
    const pillBtns = document.querySelectorAll(".pill-btn");
    pillBtns.forEach(btn => {
        const filterName = btn.getAttribute("data-filter") || "all";
        const isActive = filterName === "all"
            ? currentQuickFilters.size === 0
            : currentQuickFilters.has(filterName);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function setQuickFilters(filters = []) {
    currentQuickFilters = new Set((filters || []).filter(filterName => filterName && filterName !== "all"));
    syncQuickFilterButtons();
}

function toggleQuickFilter(filterName) {
    if (!filterName || filterName === "all") {
        setQuickFilters([]);
        return;
    }
    if (currentQuickFilters.has(filterName)) {
        currentQuickFilters.delete(filterName);
    } else {
        currentQuickFilters.add(filterName);
    }
    syncQuickFilterButtons();
}

function matchesPatientQuickFilter(pat, filterName) {
    if (filterName === 'barriers') {
        return hasActiveBarrier(pat);
    }
    if (filterName === 'pending-referrals') {
        return isPendingValue(getPatientVal(pat, 'treatmentReferralStatus'));
    }
    if (filterName === 'ncm-cases') {
        return isYesValue(getPatientVal(pat, 'ncm'));
    }
    if (filterName === 'permit-stage') {
        return isYesValue(getPatientVal(pat, 'permitSent'));
    }
    if (filterName === 'chemo-missing') {
        return !isValidDateValue(getPatientVal(pat, 'chemoDate'));
    }
    if (filterName === 'chemo-scheduled') {
        return isValidDateValue(getPatientVal(pat, 'chemoDate'));
    }
    if (filterName === 'permit-pending') {
        const permitSent = getPatientVal(pat, 'permitSent');
        const permitStatus = getPatientVal(pat, 'permitStatus');
        return isYesValue(permitSent) && (isPendingValue(permitStatus) || isEmptyLike(permitStatus));
    }
    if (filterName === 'other-referral-pending') {
        const forms = getPatientVal(pat, 'referralForms');
        const otherStatus = getPatientVal(pat, 'otherReferralStatus');
        return !isEmptyLike(forms) && !isNoValue(forms) && isPendingValue(otherStatus);
    }
    if (filterName === 'not-notified') {
        return isValidDateValue(getPatientVal(pat, 'chemoDate')) && isNoValue(getPatientVal(pat, 'notified'));
    }
    if (filterName === 'guidance-pending') {
        return isEffectiveTreatmentReferralApproved(pat) && isNeedsFollowupStatus(getPatientVal(pat, 'guidance'));
    }
    if (filterName === 'data-problems') {
        return getDataProblems(pat).length > 0;
    }
    return true;
}

function matchesSelectedQuickFilters(pat) {
    if (currentQuickFilters.size === 0) return true;
    return [...currentQuickFilters].every(filterName => matchesPatientQuickFilter(pat, filterName));
}

function getColumnFilterLabel(key) {
    const column = ALL_EXCEL_COLUMNS.find(col => col.key === key);
    return column ? column.label : key;
}

function getColumnFilterValues(key) {
    const values = new Set();
    patientsData.forEach(pat => {
        const value = getPatientVal(pat, key);
        if (!isEmptyLike(value)) values.add(value);
    });
    return [...values].sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.textContent = "";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);
    options.forEach(option => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        selectEl.appendChild(opt);
    });
}

function populateColumnFilterFields() {
    const fieldSelect = document.getElementById("column-filter-field");
    const valueSelect = document.getElementById("column-filter-value");
    const options = ALL_EXCEL_COLUMNS.map(col => ({ value: col.key, label: col.label }));
    setSelectOptions(fieldSelect, options, "Select field");
    setSelectOptions(valueSelect, [], "Select value");
    if (valueSelect) valueSelect.disabled = true;
}

function updateColumnFilterValueOptions() {
    const fieldSelect = document.getElementById("column-filter-field");
    const valueSelect = document.getElementById("column-filter-value");
    if (!fieldSelect || !valueSelect) return;
    const fieldKey = fieldSelect.value;
    if (!fieldKey) {
        setSelectOptions(valueSelect, [], "Select value");
        valueSelect.disabled = true;
        return;
    }
    const values = [
        { value: EMPTY_COLUMN_FILTER_VALUE, label: EMPTY_COLUMN_FILTER_LABEL },
        ...getColumnFilterValues(fieldKey).map(value => ({ value, label: value }))
    ];
    setSelectOptions(valueSelect, values, "Select value");
    valueSelect.disabled = false;
}

function renderActiveColumnFilters() {
    const container = document.getElementById("active-column-filters");
    if (!container) return;
    container.textContent = "";
    if (activeColumnFilters.length === 0) {
        const empty = document.createElement("span");
        empty.className = "column-filter-empty";
        empty.textContent = "No column filters selected";
        container.appendChild(empty);
        return;
    }
    activeColumnFilters.forEach((filter, index) => {
        const chip = document.createElement("span");
        chip.className = "column-filter-chip";
        const text = document.createElement("span");
        const filterValueLabel = filter.value === EMPTY_COLUMN_FILTER_VALUE ? EMPTY_COLUMN_FILTER_LABEL : filter.value;
        text.textContent = `${getColumnFilterLabel(filter.key)}: ${filterValueLabel}`;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", `Remove ${getColumnFilterLabel(filter.key)} filter`);
        removeBtn.dataset.index = String(index);
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        chip.appendChild(text);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

function addActiveColumnFilter() {
    const fieldSelect = document.getElementById("column-filter-field");
    const valueSelect = document.getElementById("column-filter-value");
    if (!fieldSelect || !valueSelect || !fieldSelect.value || !valueSelect.value) {
        showToast("Select a field and value first.", "info");
        return;
    }
    const nextFilter = { key: fieldSelect.value, value: valueSelect.value };
    const exists = activeColumnFilters.some(filter => filter.key === nextFilter.key && filter.value === nextFilter.value);
    if (exists) {
        showToast("This column filter is already selected.", "info");
        return;
    }
    activeColumnFilters.push(nextFilter);
    renderActiveColumnFilters();
    pagination.currentPage = 1;
    applyFilters();
}

function clearActiveColumnFilters() {
    activeColumnFilters = [];
    renderActiveColumnFilters();
}

function matchesActiveColumnFilters(pat) {
    if (activeColumnFilters.length === 0) return true;
    const filtersByColumn = new Map();
    activeColumnFilters.forEach(filter => {
        if (!filtersByColumn.has(filter.key)) filtersByColumn.set(filter.key, new Set());
        filtersByColumn.get(filter.key).add(filter.value);
    });
    for (const [key, values] of filtersByColumn.entries()) {
        const patientValue = getPatientVal(pat, key);
        const matchesEmpty = values.has(EMPTY_COLUMN_FILTER_VALUE) && isEmptyLike(patientValue);
        const matchesExactValue = values.has(patientValue);
        if (!matchesEmpty && !matchesExactValue) return false;
    }
    return true;
}

function setupInteractiveKPIs() {
    // 1. KPI Cards
    const kpiTotal = document.getElementById("kpi-total-patients");
    const kpiActive = document.getElementById("kpi-active-patients");
    const kpiPending = document.getElementById("kpi-pending-referrals");
    const kpiNcm = document.getElementById("kpi-ncm-cases");
    const kpiBarriers = document.getElementById("kpi-active-barriers");

    if (kpiTotal) {
        const card = kpiTotal.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                setQuickFilters([]);
                pagination.currentPage = 1;
                applyFilters();
                switchToMasterTab();
            });
        }
    }
    if (kpiActive) {
        const card = kpiActive.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                setQuickFilters([]);
                pagination.currentPage = 1;
                applyFilters();
                switchToMasterTab();
            });
        }
    }
    if (kpiPending) {
        const card = kpiPending.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                setQuickFilters(['pending-referrals']);
                pagination.currentPage = 1;
                applyFilters();
                switchToMasterTab();
            });
        }
    }
    if (kpiNcm) {
        const card = kpiNcm.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                setQuickFilters(['ncm-cases']);
                pagination.currentPage = 1;
                applyFilters();
                switchToMasterTab();
            });
        }
    }
    if (kpiBarriers) {
        const card = kpiBarriers.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                setQuickFilters(['barriers']);
                pagination.currentPage = 1;
                applyFilters();
                switchToMasterTab();
            });
        }
    }

    // 2. Funnel Steps
    const funnelSteps = document.querySelectorAll(".funnel-step");
    funnelSteps.forEach(step => {
        step.addEventListener("click", () => {
            const stepName = step.getAttribute("data-step");
            let filterName = 'all';
            if (stepName === 'registered') {
                filterName = 'all';
            } else if (stepName === 'pending-referrals') {
                filterName = 'pending-referrals';
            } else if (stepName === 'ncm-review') {
                filterName = 'ncm-cases';
            } else if (stepName === 'permit-stage') {
                filterName = 'permit-stage';
            } else if (stepName === 'chemo-scheduled') {
                filterName = 'chemo-scheduled';
            }

            setQuickFilters(filterName === 'all' ? [] : [filterName]);
            pagination.currentPage = 1;
            applyFilters();

            switchToMasterTab();
        });
    });
}


// --- App Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    const dependenciesReady = ensureRuntimeDependencies();
    setupThemeToggle();
    setupTabSwitching();
    setupSyncButton();
    setupFilterListeners();
    setupInteractiveKPIs();
    setupPagination();
    setupExportButton();
    setupDrawerClose();
    setupTabSearches();
    setupPrinting();
    setupMasterSearchDropdown();
    setupPatientSearch();
    setupAnalyticsModal();
    setupWorkflowModal();
    setupTriageBanner();
    setupSidebarToggle();

    setupResetCache();
    setupIdlePurge();
    if (dependenciesReady) {
        loadDashboardData({ silent: true });
    } else {
        const lastSyncEl = document.getElementById("last-sync-time");
        if (lastSyncEl) lastSyncEl.innerText = "Libraries unavailable";
    }
}

// --- Theme Toggle ---
function setupThemeToggle() {
    const themeBtn = document.getElementById("theme-toggle-btn");
    
    // Check local storage or defaults
    const currentTheme = readStorage(STORAGE_KEYS.theme, "dark") || "dark";
    if (currentTheme === "light") {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        themeBtn.setAttribute("aria-label", "Switch to Dark Mode");
    } else {
        document.body.classList.add("dark-theme");
        document.body.classList.remove("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        themeBtn.setAttribute("aria-label", "Switch to Light Mode");
    }

    themeBtn.addEventListener("click", () => {
        if (document.body.classList.contains("dark-theme")) {
            document.body.classList.remove("dark-theme");
            document.body.classList.add("light-theme");
            themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
            themeBtn.setAttribute("aria-label", "Switch to Dark Mode");
            writeStorage(STORAGE_KEYS.theme, "light");
        } else {
            document.body.classList.add("dark-theme");
            document.body.classList.remove("light-theme");
            themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
            themeBtn.setAttribute("aria-label", "Switch to Light Mode");
            writeStorage(STORAGE_KEYS.theme, "dark");
        }
        // Redraw charts to update text colors
        updateChartsTheme();
    });
}

// --- Collapsible Sidebar (mobile/tablet) ---
function setupSidebarToggle() {
    const toggleBtn = document.getElementById("sidebar-toggle-btn");
    const overlay = document.getElementById("sidebar-overlay");
    if (!toggleBtn || !overlay) return;

    function openSidebar() {
        document.body.classList.add("sidebar-open");
        toggleBtn.setAttribute("aria-expanded", "true");
        toggleBtn.setAttribute("aria-label", "Close navigation");
    }

    function closeSidebar() {
        document.body.classList.remove("sidebar-open");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.setAttribute("aria-label", "Open navigation");
    }

    toggleBtn.addEventListener("click", () => {
        if (document.body.classList.contains("sidebar-open")) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    overlay.addEventListener("click", closeSidebar);

    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            if (window.innerWidth <= 1024) closeSidebar();
        });
    });
}

// --- Tab Switching ---
function setupTabSwitching() {
    const navItems = document.querySelectorAll(".nav-item");
    const tabPanes = document.querySelectorAll(".tab-pane");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");

            navItems.forEach(i => { i.classList.remove("active"); i.removeAttribute("aria-current"); });
            tabPanes.forEach(p => p.classList.remove("active"));

            item.classList.add("active");
            item.setAttribute("aria-current", "page");
            const targetPane = document.getElementById(`tab-${targetTab}`);
            if (!targetPane) {
                console.warn(`Tab pane not found for "${targetTab}"`);
                return;
            }
            targetPane.classList.add("active");
            
            // Re-render specific tabs if needed
            if (targetTab === 'master') {
                applyFilters();
            } else if (targetTab === 'patient-search') {
                renderPatientSearchResults();
            } else if (targetTab === 'followup') {
                renderFollowupTab();
            } else if (targetTab === 'ncm') {
                renderNcmTab();
            } else if (targetTab === 'inpatient') {
                renderInpatientTab();
            } else if (targetTab === 'outpatient') {
                renderOutpatientTab();
            } else if (targetTab === 'barriers') {
                renderBarriersTab();
            } else if (targetTab === 'analytics') {
                renderAnalyticsTab();
            } else if (targetTab === 'workflow') {
                renderWorkflowTab();
            }
        });
    });
}

// --- F-01 hardening: clear cached PHI after a period of user inactivity ---
function setupIdlePurge() {
    let idleTimer = null;

    const purge = () => {
        // Only act if PHI is actually cached in this session.
        if (readStorage(STORAGE_KEYS.data) === null) return;
        removeStorage(STORAGE_KEYS.data);
        showToast("Session idle — cached patient data cleared for privacy. Please re-upload your file.", "info");
        setTimeout(() => { window.location.reload(); }, 1500);
    };

    const resetTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(purge, PHI_IDLE_TIMEOUT_MS);
    };

    ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
        window.addEventListener(evt, resetTimer, { passive: true });
    });
    resetTimer();
}

function setupResetCache() {
    const resetCacheBtn = document.getElementById("reset-cache-btn");
    if (resetCacheBtn) {
        resetCacheBtn.addEventListener("click", () => {
            const confirmed = window.confirm("Clear all locally cached dashboard data from this browser?");
            if (!confirmed) return;
            removeStorage(STORAGE_KEYS.data);
            showToast("Cache cleared! Reloading dashboard...", "info");
            setTimeout(() => { window.location.reload(); }, 1000);
        });
    }
}

function setSyncStepState(stepEl, state, html) {
    if (!stepEl) return;
    stepEl.className = `step ${state}`;
    stepEl.innerHTML = html;
}

function showSyncOverlay() {
    const overlay = document.getElementById("sync-loading-overlay");
    if (overlay) overlay.classList.remove("hidden");
    setSyncStepState(document.getElementById("step-connect"), "active", '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading local file...');
    setSyncStepState(document.getElementById("step-download"), "", '<i class="fa-solid fa-circle"></i> Parsing worksheets using SheetJS');
    setSyncStepState(document.getElementById("step-parse"), "", '<i class="fa-solid fa-circle"></i> Calculating metrics and drawing dashboard');
}

function hideSyncOverlay() {
    const overlay = document.getElementById("sync-loading-overlay");
    if (overlay) overlay.classList.add("hidden");
}


function applyDashboardData(patients, lists, metadata, options = {}) {
    patientsData = patients;
    dropdownLists = lists;

    const lastSyncTime = metadata.last_synced || new Date().toLocaleString("en-US", { hour12: true });
    const lastSyncEl = document.getElementById("last-sync-time");
    if (lastSyncEl) lastSyncEl.innerText = lastSyncTime;

    const cachedData = {
        patients: patientsData,
        lists: dropdownLists,
        metadata: {
            ...metadata,
            last_synced: lastSyncTime,
            total_records: patientsData.length
        }
    };
    writeStorage(STORAGE_KEYS.data, JSON.stringify(cachedData));

    const initialOverlay = document.getElementById("initial-load-overlay");
    if (initialOverlay) initialOverlay.classList.add("hidden");

    populateFilterOptions();
    calculateKPIs();
    renderCharts();
    applyFilters();
    updateBadges();

    if (options.toastMessage) {
        showToast(options.toastMessage, options.toastType || "success");
    }
}

function processWorkbook(workbook) {
    const trackingSheet = workbook.Sheets["Tracking sheet"];
    if (!trackingSheet) {
        throw new Error("'Tracking sheet' worksheet not found in the workbook!");
    }
    if (!trackingSheet['!ref']) {
        throw new Error("Tracking sheet is empty.");
    }

    const range = XLSX.utils.decode_range(trackingSheet['!ref']);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cellRef = XLSX.utils.encode_cell({r: r, c: c});
            const cell = trackingSheet[cellRef];
            row.push(cell ? cell.v : "");
        }
        rows.push(row);
    }

    if (rows.length < 4) {
        throw new Error("Tracking sheet does not have enough rows.");
    }

    let headerIdx = -1;
    const NAME_HEADER_SIGNALS = ["patient name", "patientname", "اسم المريض", "ø§ø³ù… ø§ù„ù…ø±ùšø¶"];
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const rowCells = rows[i].map(c => String(c || '').normalize("NFKC").trim().toLowerCase());
        if (rowCells.some(cell => NAME_HEADER_SIGNALS.some(sig => cell.includes(sig)))) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) {
        headerIdx = Math.min(3, rows.length - 1);
        console.warn("[OncoCoord] Could not auto-detect header row. Falling back to row", headerIdx, ". First row cells:", rows[0]);
    }
    console.debug("[OncoCoord] Header row detected at index", headerIdx, "| headers:", rows[headerIdx]);

    const rawHeaders = rows[headerIdx].map((h, i) => String(h || '').normalize("NFKC").trim() || `Column_${i}`);

    // Build a normalized-alias → first-alias (canonical) lookup so Excel header variants
    // (different casing, Unicode form, invisible whitespace) all resolve to a single key.
    const normalizedToCanonical = {};
    for (const aliases of Object.values(KEY_MAP)) {
        const canonical = aliases[0];
        for (const alias of aliases) {
            normalizedToCanonical[normalizeValue(alias)] = canonical;
        }
    }
    const headers = rawHeaders.map(h => normalizedToCanonical[normalizeValue(h)] || h);

    console.debug("[OncoCoord] Raw headers:", rawHeaders);
    console.debug("[OncoCoord] Canonical headers:", headers);

    const patients = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0] || !String(row[0]).trim()) {
            continue;
        }
        const pat = {};
        for (let c = 0; c < headers.length; c++) {
            const h = headers[c];
            const val = row[c];
            pat[h] = excelValueToString(val, h);
        }
        patients.push(pat);
    }

    const listsSheet = workbook.Sheets["Lists"];
    const parsedLists = {};
    if (listsSheet) {
        const listRows = XLSX.utils.sheet_to_json(listsSheet, {header: 1});
        if (listRows.length > 0) {
            const listHeaders = listRows[0];
            for (let c = 0; c < listHeaders.length; c++) {
                const h = String(listHeaders[c] || '').trim();
                if (!h) continue;
                const values = [];
                for (let r = 1; r < listRows.length; r++) {
                    if (listRows[r] && listRows[r][c] !== undefined && listRows[r][c] !== null) {
                        const cleanVal = cleanValueJS(listRows[r][c]);
                        if (cleanVal) values.push(cleanVal);
                    }
                }
                parsedLists[h] = values;
            }
        }
    }

    return { patients, lists: parsedLists };
}

// --- Fetch Dashboard Data ---
function loadDashboardData(options = {}) {
    const lastSyncEl = document.getElementById("last-sync-time");
    const cachedData = readStorage(STORAGE_KEYS.data);
    
    if (!cachedData) {
        const initialOverlay = document.getElementById("initial-load-overlay");
        if (initialOverlay) initialOverlay.classList.remove("hidden");
        if (lastSyncEl) lastSyncEl.innerText = "No data — please upload your Excel file";
        return;
    }

    const initialOverlay = document.getElementById("initial-load-overlay");
    if (initialOverlay) initialOverlay.classList.add("hidden");

    try {
        const data = JSON.parse(cachedData);
        patientsData = data.patients || [];
        dropdownLists = data.lists || {};
        
        if (data.metadata) {
            lastSyncEl.innerText = data.metadata.last_synced;
        }
        
        // Build dynamic dropdowns based on actual patient data
        populateFilterOptions();
        
        // Refresh dashboard states
        calculateKPIs();
        renderCharts();
        
        // Initial render
        applyFilters();
        updateBadges();
        
        if (!options.silent) showToast("Patient data loaded from local storage", "success");
    } catch(err) {
        console.error("Local cache read error:", err);
        showToast("Failed to parse cached data. Please upload your file again.", "error");
        lastSyncEl.innerText = "Error";
    }
}

// --- Setup File Upload / Parser Listeners ---
function setupSyncButton() {
    // We hook into all potential file inputs
    const inputs = ["excel-file-upload", "excel-file-initial", "settings-file-upload"];
    
    inputs.forEach(id => {
        const inputEl = document.getElementById(id);
        if (inputEl) {
            inputEl.addEventListener("change", (e) => {
                const file = e.target.files[0];
                if (file) {
                    processUploadedExcel(file);
                }
            });
        }
    });
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error("Failed to read the file."));
        reader.readAsArrayBuffer(file);
    });
}

// Excel serial date to YYYY-MM-DD string
function excelDateToStr(serial) {
    if (!serial) return "";
    try {
        const val = parseFloat(serial);
        if (isNaN(val) || val === 0) return "";
        const epoch = new Date(1899, 11, 30);
        const date = new Date(epoch.getTime() + val * 24 * 60 * 60 * 1000);
        return date.toISOString().split('T')[0];
    } catch (e) {
        return String(serial).trim();
    }
}

// Clean raw values
function cleanValueJS(val) {
    let s = String(val === undefined || val === null ? "" : val).trim();
    if (s === "0" || s === "0.0") return "";
    return s;
}

// Format Excel value to String
function excelValueToString(val, headerName) {
    if (val === undefined || val === null) return "";
    
    if (val instanceof Date) {
        const y = val.getFullYear();
        // Reject epoch/zero-serial dates (Excel serial 0 = 1899-12-30) and far-future garbage
        if (isNaN(y) || y < 1990 || y > 2100) return "";
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    
    const headerLower = String(headerName).toLowerCase();
    const isDateCol = headerLower.includes("date of clinic") || 
                       headerLower.includes("appointment date") || 
                       headerLower.includes("visit date") || 
                       headerLower.includes("other appointment");
                       
    if (typeof val === 'number' && isDateCol) {
        return excelDateToStr(val);
    }
    
    return cleanValueJS(val);
}

// Main SheetJS Excel parsing logic
async function processUploadedExcel(file) {
    if (typeof XLSX === "undefined") {
        showToast("SheetJS is unavailable. Excel files cannot be parsed until the library loads.", "error");
        return;
    }
    if (!file || !file.name.toLowerCase().endsWith(".xlsx")) {
        showToast("Please upload a valid .xlsx Excel tracker.", "error");
        return;
    }

    const stepConnect = document.getElementById("step-connect");
    const stepDownload = document.getElementById("step-download");
    const stepParse = document.getElementById("step-parse");

    showSyncOverlay();

    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        setSyncStepState(stepConnect, "completed", '<i class="fa-solid fa-circle-check"></i> Local file read successfully');
        setSyncStepState(stepDownload, "active", '<i class="fa-solid fa-circle-notch fa-spin"></i> Parsing worksheets using SheetJS...');

        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });
        const { patients, lists } = processWorkbook(workbook);

        setSyncStepState(stepDownload, "completed", '<i class="fa-solid fa-circle-check"></i> Worksheets parsed successfully');
        setSyncStepState(stepParse, "active", '<i class="fa-solid fa-circle-notch fa-spin"></i> Calculating metrics and drawing dashboard...');

        applyDashboardData(patients, lists, {
            source: "manual-upload",
            file_name: file.name,
            last_synced: new Date().toLocaleString("en-US", { hour12: true })
        }, {
            toastMessage: `Data processed successfully! Loaded ${patients.length} records.`,
            toastType: "success"
        });
        setSyncStepState(stepParse, "completed", '<i class="fa-solid fa-circle-check"></i> Dashboard updated');
    } catch (err) {
        console.error("Excel parse error:", err);
        showToast("Failed to parse Excel file: " + err.message, "error");
    } finally {
        setTimeout(hideSyncOverlay, 700);
    }
}

// --- Populate Filter Dropdowns Dynamically ---
function populateFilterOptions() {
    const clinics = new Set();
    const divisions = new Set();
    const coordinators = new Set();
    const statuses = new Set();
    
    patientsData.forEach(pat => {
        const cl = getPatientVal(pat, 'clinic');
        const div = getPatientVal(pat, 'division');
        const co = getPatientVal(pat, 'coordinator');
        const st = getPatientVal(pat, 'status');
        
        if (cl) clinics.add(cl);
        if (div) divisions.add(div);
        if (co) coordinators.add(co);
        if (st) statuses.add(st);
    });

    const populateDropdown = (elementId, items) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = "";
        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All";
        el.appendChild(allOption);
        [...items].sort().forEach(item => {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            el.appendChild(option);
        });
    };

    populateDropdown("filter-clinic", clinics);
    populateDropdown("filter-division", divisions);
    populateDropdown("filter-coordinator", coordinators);
    populateDropdown("filter-status", statuses);
    populateColumnFilterFields();
    renderActiveColumnFilters();
}

// --- Calculate KPIs ---
function calculateKPIs() {
    const total = patientsData.length;

    let active = 0;
    let pendingReferrals = 0;
    let ncmCount = 0;
    let activeBarriers = 0;
    let missingChemo = 0;

    patientsData.forEach(pat => {
        const status = normalizeValue(getPatientVal(pat, 'status'));
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        const chemoDate = getPatientVal(pat, 'chemoDate');

        if (status === 'active' || status === 'نشط' || status === 'مستمر') active++;
        if (isPendingValue(refStatus)) pendingReferrals++;
        if (isYesValue(ncm)) ncmCount++;
        if (hasActiveBarrier(pat)) activeBarriers++;
        if (isApprovedValue(refStatus) && !isValidDateValue(chemoDate)) missingChemo++;
    });

    document.getElementById("kpi-total-patients").innerText = total;
    document.getElementById("kpi-active-patients").innerText = active;
    document.getElementById("kpi-pending-referrals").innerText = pendingReferrals;
    document.getElementById("kpi-ncm-cases").innerText = ncmCount;
    document.getElementById("kpi-active-barriers").innerText = activeBarriers;
    updateMasterFunnel();
    updateTriageBanner(activeBarriers, missingChemo, pendingReferrals, ncmCount);
}

function updateTriageBanner(barriers, missingChemo, pendingReferrals, ncmCount) {
    const el = id => document.getElementById(id);
    if (el('triage-count-barriers'))  el('triage-count-barriers').innerText = barriers;
    if (el('triage-count-chemo'))     el('triage-count-chemo').innerText = missingChemo;
    if (el('triage-count-pending'))   el('triage-count-pending').innerText = pendingReferrals;
    if (el('triage-count-ncm-item'))  el('triage-count-ncm-item').innerText = ncmCount;
}

function setupTriageBanner() {
    const navTo = tab => document.querySelector(`.nav-item[data-tab="${tab}"]`);
    const items = [
        ['triage-barriers',     'barriers'],
        ['triage-missing-chemo','analytics'],
        ['triage-pending',      'followup'],
        ['triage-ncm-item',     'ncm'],
    ];
    items.forEach(([id, tab]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', () => navTo(tab)?.click());
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navTo(tab)?.click(); }
        });
    });
}

// --- Update Badges in Sidebar ---
function updateBadges() {
    let pendingReferrals = 0;
    let ncmCount = 0;
    let activeBarriers = 0;
    
    patientsData.forEach(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        
        if (isPendingValue(refStatus)) pendingReferrals++;
        if (isYesValue(ncm)) ncmCount++;
        if (hasActiveBarrier(pat)) activeBarriers++;
    });

    document.getElementById("badge-followup").innerText = pendingReferrals;
    document.getElementById("badge-ncm").innerText = ncmCount;
    document.getElementById("badge-barriers").innerText = activeBarriers;

    // Analytics badge = total issues across all 6 analyses
    const analyticsTotal = computeAnalyticsCounts();
    document.getElementById("badge-analytics").innerText = analyticsTotal.total;

    // Workflow badge = distinct patients needing action (lists A-I + L)
    let workflowActionCount = 0;
    const ACTION_LISTS = new Set(['A','B','C','D','E','F','G','H','I','L']);
    patientsData.forEach(pat => {
        const lists = getPatientWorkflowLists(pat);
        for (const id of lists) {
            if (ACTION_LISTS.has(id)) { workflowActionCount++; break; }
        }
    });
    const wBadge = document.getElementById("badge-workflow");
    if (wBadge) wBadge.innerText = workflowActionCount;
}

// --- Filters & Grid Search ---
function setupFilterListeners() {
    const searchInput = document.getElementById("master-search-input");
    const filterClinic = document.getElementById("filter-clinic");
    const filterDivision = document.getElementById("filter-division");
    const filterCoordinator = document.getElementById("filter-coordinator");
    const filterStatus = document.getElementById("filter-status");
    const clearBtn = document.getElementById("clear-filters-btn");
    const columnFieldSelect = document.getElementById("column-filter-field");
    const addColumnFilterBtn = document.getElementById("add-column-filter-btn");
    const activeColumnFiltersEl = document.getElementById("active-column-filters");
    
    const elements = [searchInput, filterClinic, filterDivision, filterCoordinator, filterStatus];
    
    elements.forEach(el => {
        if (el) {
            el.addEventListener("input", () => {
                pagination.currentPage = 1;
                applyFilters();
            });
        }
    });

    // Quick filter pills listener
    const pillBtns = document.querySelectorAll(".pill-btn");
    pillBtns.forEach(btn => {
        btn.setAttribute("aria-pressed", btn.classList.contains("active") ? "true" : "false");
        btn.addEventListener("click", () => {
            toggleQuickFilter(btn.getAttribute("data-filter") || 'all');
            pagination.currentPage = 1;
            applyFilters();
        });
    });

    if (columnFieldSelect) {
        columnFieldSelect.addEventListener("change", updateColumnFilterValueOptions);
    }

    if (addColumnFilterBtn) {
        addColumnFilterBtn.addEventListener("click", addActiveColumnFilter);
    }

    if (activeColumnFiltersEl) {
        activeColumnFiltersEl.addEventListener("click", (event) => {
            const removeBtn = event.target.closest("button[data-index]");
            if (!removeBtn) return;
            const index = Number(removeBtn.dataset.index);
            if (!Number.isInteger(index)) return;
            activeColumnFilters.splice(index, 1);
            renderActiveColumnFilters();
            pagination.currentPage = 1;
            applyFilters();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            filterClinic.value = "";
            filterDivision.value = "";
            filterCoordinator.value = "";
            filterStatus.value = "";
            
            // Clear tab-specific searches
            document.querySelectorAll(".table-actions input[type='text'], .filter-bar input[type='text']").forEach(inp => inp.value = "");
            
            // Reset quick filter pills
            setQuickFilters([]);
            clearActiveColumnFilters();
            const columnFieldSelect = document.getElementById("column-filter-field");
            const columnValueSelect = document.getElementById("column-filter-value");
            if (columnFieldSelect) columnFieldSelect.value = "";
            if (columnValueSelect) {
                setSelectOptions(columnValueSelect, [], "Select value");
                columnValueSelect.disabled = true;
            }

            pagination.currentPage = 1;
            applyFilters();
            
            // Re-render other tabs to clear their search
            renderFollowupTab();
            renderNcmTab();
            renderInpatientTab();
            renderOutpatientTab();
            renderBarriersTab();
            renderAnalyticsTab();
            renderWorkflowTab();
            
            showToast("Filters cleared and reset", "info");
        });
    }

    // Sort column listeners
    const thElements = document.querySelectorAll("#patients-data-table th[data-sort]");
    thElements.forEach(th => {
        th.addEventListener("click", () => {
            const column = th.getAttribute("data-sort");
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            
            // Update sort arrows UI and aria-sort
            thElements.forEach(el => {
                const icon = el.querySelector("i");
                if (icon) icon.className = "fa-solid fa-sort";
                el.setAttribute("aria-sort", "none");
            });
            const activeIcon = th.querySelector("i");
            if (activeIcon) {
                activeIcon.className = currentSort.direction === 'asc' ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
            th.setAttribute("aria-sort", currentSort.direction === 'asc' ? "ascending" : "descending");
            
            applyFilters();
        });
    });
}

function applyFilters() {
    const searchQuery = document.getElementById("master-search-input").value.toLowerCase();
    const clinicVal = document.getElementById("filter-clinic").value;
    const divisionVal = document.getElementById("filter-division").value;
    const coordinatorVal = document.getElementById("filter-coordinator").value;
    const statusVal = document.getElementById("filter-status").value;
    
    filteredPatients = patientsData.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        const clinic = getPatientVal(pat, 'clinic');
        const division = getPatientVal(pat, 'division');
        const coordinator = getPatientVal(pat, 'coordinator');
        const status = getPatientVal(pat, 'status');
        
        // Search term check
        const matchesSearch = name.includes(searchQuery) || id.includes(searchQuery) || file.includes(searchQuery);
        
        // Filters check
        const matchesClinic = !clinicVal || clinic === clinicVal;
        const matchesDivision = !divisionVal || division === divisionVal;
        const matchesCoordinator = !coordinatorVal || coordinator === coordinatorVal;
        const matchesStatus = !statusVal || status === statusVal;
        
        // Quick filters combine with AND logic when more than one pill is selected.
        const matchesQuickFilter = matchesSelectedQuickFilters(pat);
        const matchesColumnFilters = matchesActiveColumnFilters(pat);
        
        return matchesSearch && matchesClinic && matchesDivision && matchesCoordinator && matchesStatus && matchesQuickFilter && matchesColumnFilters;
    });

    // Apply Sorting
    sortPatients();
    
    // Render Main Table
    renderMainTable();
}

function sortPatients() {
    filteredPatients.sort((a, b) => {
        // Map abstract sorting column to correct key in target object
        let valA = "", valB = "";
        
        // Find corresponding keys in KEY_MAP
        for (const [abstractKey, headers] of Object.entries(KEY_MAP)) {
            if (headers.includes(currentSort.column)) {
                valA = getPatientVal(a, abstractKey);
                valB = getPatientVal(b, abstractKey);
                break;
            }
        }
        
        // Fallback to direct key if not found in abstract map
        if (!valA && a[currentSort.column]) valA = a[currentSort.column].toString();
        if (!valB && b[currentSort.column]) valB = b[currentSort.column].toString();
        
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();

        // Handle numeric sorting if both are numbers
        if (!isNaN(valA) && !isNaN(valB) && valA !== "" && valB !== "") {
            return currentSort.direction === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        }
        
        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function makeRowInteractive(row, pat) {
    row.setAttribute("tabindex", "0");
    row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPatientDrawer(pat);
        }
    });
}

function renderMainTable() {
    const tbody = document.getElementById("patients-table-body");
    const countEl = document.getElementById("matching-records-count");
    
    countEl.innerText = filteredPatients.length;
    tbody.innerHTML = "";
    
    if (filteredPatients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11"><div class="table-empty-state"><i class="fa-solid fa-magnifying-glass"></i><h4>No matching patients</h4><p>Try adjusting your search or filters to find patients.</p></div></td></tr>`;
        updatePaginationUI(0);
        return;
    }
    
    // Pagination calculation
    const total = filteredPatients.length;
    const startIndex = (pagination.currentPage - 1) * pagination.pageSize;
    const endIndex = Math.min(startIndex + pagination.pageSize, total);
    
    const pagePatients = filteredPatients.slice(startIndex, endIndex);
    
    pagePatients.forEach(pat => {
        const name = getPatientVal(pat, 'name');
        const id = getPatientVal(pat, 'id');
        const clinic = getPatientVal(pat, 'clinic');
        const division = getPatientVal(pat, 'division');
        const coordinator = getPatientVal(pat, 'coordinator');
        const physician = getPatientVal(pat, 'physician');
        const treatmentRef = getPatientVal(pat, 'treatmentReferralStatus');
        const permit = getPatientVal(pat, 'permitStatus');
        const status = getPatientVal(pat, 'status');
        
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", id);
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${escapeHTML(id)}</td>
            <td>${escapeHTML(clinic)}</td>
            <td>${escapeHTML(division || '-')}</td>
            <td>${escapeHTML(coordinator)}</td>
            <td>${escapeHTML(physician)}</td>
            <td><span class="status-pill ${getPillClass(treatmentRef)}">${escapeHTML(treatmentRef || 'none')}</span></td>
            <td><span class="status-pill ${getPillClass(permit)}">${escapeHTML(permit || 'none')}</span></td>
            <td><span class="status-pill ${getPillClass(status)}">${escapeHTML(status || 'none')}</span></td>
            <td class="smart-notes-cell">
                ${generateMiniTimelineHTML(pat)}
                ${generateSmartNotesChips(pat)}
            </td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        
        row.querySelector(".open-details-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            openPatientDrawer(pat);
        });

        row.addEventListener("click", () => { openPatientDrawer(pat); });
        makeRowInteractive(row, pat);

        tbody.appendChild(row);
    });

    updatePaginationUI(total);
}

function getPillClass(val) {
    if (!val) return 'none';
    if (isApprovedValue(val)) return 'approved';
    if (isPendingValue(val)) return 'pending';
    if (isRejectedValue(val)) return 'rejected';
    return 'none';
}

// --- Pagination Controls ---
function setupPagination() {
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");
    
    prevBtn.addEventListener("click", () => {
        if (pagination.currentPage > 1) {
            pagination.currentPage--;
            renderMainTable();
        }
    });
    
    nextBtn.addEventListener("click", () => {
        const maxPages = Math.ceil(filteredPatients.length / pagination.pageSize);
        if (pagination.currentPage < maxPages) {
            pagination.currentPage++;
            renderMainTable();
        }
    });
}

function updatePaginationUI(total) {
    const infoText = document.getElementById("pagination-info-text");
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");
    
    if (total === 0) {
        infoText.innerText = "Showing 0 to 0 of 0 cases";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    
    const startIndex = (pagination.currentPage - 1) * pagination.pageSize + 1;
    const endIndex = Math.min(startIndex + pagination.pageSize - 1, total);
    const maxPages = Math.ceil(total / pagination.pageSize);
    
    infoText.innerText = `Showing ${startIndex} to ${endIndex} of ${total} cases (Page ${pagination.currentPage} of ${maxPages})`;
    
    prevBtn.disabled = pagination.currentPage === 1;
    nextBtn.disabled = pagination.currentPage === maxPages || maxPages === 0;
}

// --- Render Follow-Up Tab ---
function renderFollowupTab() {
    const tbody = document.getElementById("followup-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("followup-search-input") ? document.getElementById("followup-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const isPending = isPendingValue(getPatientVal(pat, 'treatmentReferralStatus'));
        if (!isPending) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-solid fa-circle-check"></i><h4>No pending referrals</h4><p>All treatment referrals are resolved or none have been registered yet.</p></div></td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'physician')}</td>
            <td>${getEscapedPatientVal(pat, 'treatmentPlan', '-')}</td>
            <td class="text-danger">${getEscapedPatientVal(pat, 'barrier', '-')}</td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        makeRowInteractive(row, pat);
        tbody.appendChild(row);
    });
}

// --- Render New Cases Meeting Tab ---
function renderNcmTab() {
    const tbody = document.getElementById("ncm-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("ncm-search-input") ? document.getElementById("ncm-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const isNcm = isYesValue(getPatientVal(pat, 'ncm'));
        if (!isNcm) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-solid fa-user-doctor"></i><h4>No NCM cases</h4><p>No cases are scheduled for the weekly meeting.</p></div></td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'physician')}</td>
            <td>${getEscapedPatientVal(pat, 'treatmentPlan', '-')}</td>
            <td class="text-indigo"><strong>${getEscapedPatientVal(pat, 'ncmDecision', '-')}</strong></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getEscapedPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        makeRowInteractive(row, pat);
        tbody.appendChild(row);
    });
}

// --- Render Inpatient Tab ---
function renderInpatientTab() {
    const tbody = document.getElementById("inpatient-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("inpatient-search-input") ? document.getElementById("inpatient-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const isInpatient = getPatientVal(pat, 'division').toLowerCase().includes('inpatient');
        if (!isInpatient) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-solid fa-bed"></i><h4>No inpatient cases</h4><p>No inpatient cases are currently registered in the system.</p></div></td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getEscapedPatientVal(pat, 'chemoDate', '-')}</td>
            <td class="text-danger">${getEscapedPatientVal(pat, 'barrier', '-')}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getEscapedPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        makeRowInteractive(row, pat);
        tbody.appendChild(row);
    });
}

// --- Render Outpatient Tab ---
function renderOutpatientTab() {
    const tbody = document.getElementById("outpatient-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("outpatient-search-input") ? document.getElementById("outpatient-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const isOutpatient = getPatientVal(pat, 'division').toLowerCase().includes('outpatient');
        if (!isOutpatient) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-solid fa-house-medical-flag"></i><h4>No outpatient cases</h4><p>No outpatient cases are currently registered in the system.</p></div></td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getEscapedPatientVal(pat, 'chemoDate', '-')}</td>
            <td class="text-danger">${getEscapedPatientVal(pat, 'barrier', '-')}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getEscapedPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        makeRowInteractive(row, pat);
        tbody.appendChild(row);
    });
}

// --- Render Barriers Tab ---
function renderBarriersTab() {
    const tbody = document.getElementById("barriers-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("barriers-search-input") ? document.getElementById("barriers-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const barrier = getPatientVal(pat, 'barrier');
        const hasBarrier = barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no';
        if (!hasBarrier) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-solid fa-circle-check"></i><h4>All clear</h4><p>No active barriers or coordination issues currently.</p></div></td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td class="text-danger"><strong>${getEscapedPatientVal(pat, 'barrier')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'notes', '-')}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'treatmentReferralStatus'))}">${getEscapedPatientVal(pat, 'treatmentReferralStatus')}</span></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'permitStatus'))}">${getEscapedPatientVal(pat, 'permitStatus')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        makeRowInteractive(row, pat);
        tbody.appendChild(row);
    });
}

// --- Sliding Details Drawer Render ---
function openPatientDrawer(pat) {
    // Fill values
    document.getElementById("drawer-patient-name").innerText = getPatientVal(pat, 'name');
    document.getElementById("drawer-patient-id").innerText = getPatientVal(pat, 'id') || '-';
    document.getElementById("drawer-patient-file").innerText = getPatientVal(pat, 'file') || '-';
    
    // Redesigned Top Summary Board
    const referralTypeSummary = document.getElementById("drawer-referral-type-summary");
    const referralFormsSummary = document.getElementById("drawer-referral-forms-summary");
    const treatmentPlanSummary = document.getElementById("drawer-treatment-plan-summary");
    const chBadge = document.getElementById("drawer-chemo-date-badge");
    
    const referralType = getPatientVal(pat, 'referralType') || '-';
    const referralForms = getPatientVal(pat, 'referralForms') || '-';
    const treatmentPlan = getPatientVal(pat, 'treatmentPlan') || '-';
    const chDt = getPatientVal(pat, 'chemoDate') || '-';
    
    referralTypeSummary.innerText = referralType;
    referralFormsSummary.innerText = referralForms;
    treatmentPlanSummary.innerText = treatmentPlan;
    
    chBadge.innerText = chDt && chDt !== '0' && chDt !== '0.0' ? chDt : 'Not Scheduled';
    chBadge.className = `sb-val ${chDt && chDt !== '0' && chDt !== '0.0' ? 'text-green' : 'text-warning'}`;
    
    // Redesigned Workflow Next Action Hint Banner
    const actionHint = getPatientActionHint(pat);
    const hintContainer = document.getElementById("drawer-action-hint-container");
    const hintText = document.getElementById("drawer-action-hint-text");
    hintText.innerText = actionHint.text;
    hintContainer.className = `drawer-action-hint-container ${actionHint.class}`;

    // Fill demographic and clinical fields
    document.getElementById("drawer-clinic").innerText = getPatientVal(pat, 'clinic') || '-';
    document.getElementById("drawer-division").innerText = getPatientVal(pat, 'division') || '-';
    document.getElementById("drawer-clinic-visit").innerText = getPatientVal(pat, 'visitDate') || '-';
    document.getElementById("drawer-diagnosis").innerText = getPatientVal(pat, 'diagnosis') || '-';
    document.getElementById("drawer-mobile").innerText = getPatientVal(pat, 'mobile') || '-';
    
    const statusVal = getPatientVal(pat, 'status');
    const statusEl = document.getElementById("drawer-case-status");
    statusEl.innerText = statusVal || '-';
    statusEl.className = `value status-pill ${getPillClass(statusVal)}`;

    document.getElementById("drawer-coordinator").innerText = getPatientVal(pat, 'coordinator') || '-';
    document.getElementById("drawer-physician").innerText = getPatientVal(pat, 'physician') || '-';
    
    const guidanceVal = getPatientVal(pat, 'guidance');
    const guidanceEl = document.getElementById("drawer-guidance");
    guidanceEl.innerText = guidanceVal || '-';
    guidanceEl.className = `value status-pill ${getPillClass(guidanceVal)}`;
    
    document.getElementById("drawer-referral-type").innerText = getPatientVal(pat, 'referralType') || '-';
    document.getElementById("drawer-referral-forms").innerText = getPatientVal(pat, 'referralForms') || '-';
    
    const tRefVal = getPatientVal(pat, 'treatmentReferralStatus');
    const tRefEl = document.getElementById("drawer-treatment-referral-status");
    tRefEl.innerText = tRefVal || '-';
    tRefEl.className = `value status-pill ${getPillClass(tRefVal)}`;
    
    document.getElementById("drawer-other-referral-status").innerText = getPatientVal(pat, 'otherReferralStatus') || '-';
    
    const permitSentVal = getPatientVal(pat, 'permitSent');
    const permitSentEl = document.getElementById("drawer-permit-sent");
    permitSentEl.innerText = permitSentVal || '-';
    permitSentEl.className = `value status-pill ${getPillClass(permitSentVal)}`;
    
    const permitStVal = getPatientVal(pat, 'permitStatus');
    const permitStEl = document.getElementById("drawer-permit-status");
    permitStEl.innerText = permitStVal || '-';
    permitStEl.className = `value status-pill ${getPillClass(permitStVal)}`;
    
    document.getElementById("drawer-patient-notified").innerText = getPatientVal(pat, 'notified') || '-';
    document.getElementById("drawer-chemo-date").innerText = getPatientVal(pat, 'chemoDate') || '-';
    document.getElementById("drawer-other-appointment").innerText = getPatientVal(pat, 'otherAppt') || '-';
    document.getElementById("drawer-patient-notified-other").innerText = getPatientVal(pat, 'notifiedOther') || '-';
    
    const ncmVal = getPatientVal(pat, 'ncm');
    const ncmEl = document.getElementById("drawer-ncm-flag");
    ncmEl.innerText = ncmVal || '-';
    ncmEl.className = `value status-pill ${getPillClass(ncmVal)}`;
    
    document.getElementById("drawer-treatment-plan").innerText = getPatientVal(pat, 'treatmentPlan') || '-';
    document.getElementById("drawer-ncm-decision").innerText = getPatientVal(pat, 'ncmDecision') || '-';
    
    const barrier = getPatientVal(pat, 'barrier');
    const barrierAlertCard = document.getElementById("drawer-barrier-alert-card");
    const barrierAlertText = document.getElementById("drawer-barrier-alert-text");
    const barrierContainer = document.getElementById("drawer-barrier-container");
    const barrierEl = document.getElementById("drawer-current-barrier");
    if (hasActiveBarrier(pat)) {
        barrierEl.innerText = barrier;
        barrierEl.className = "barrier-value text-danger font-weight-bold";
        if (barrierAlertCard && barrierAlertText) {
            barrierAlertText.innerText = barrier;
            barrierAlertCard.classList.remove("hidden");
        }
    } else {
        barrierEl.innerText = "No active barriers recorded for this file.";
        barrierEl.className = "barrier-value text-muted";
        if (barrierAlertCard) {
            barrierAlertCard.classList.add("hidden");
        }
    }
    
    const notesVal = getPatientVal(pat, 'notes');
    const notesEl = document.getElementById("drawer-notes");
    if (notesVal && notesVal !== '0' && notesVal !== '0.0') {
        notesEl.innerText = notesVal;
        notesEl.className = "notes-value";
    } else {
        notesEl.innerText = "No additional notes.";
        notesEl.className = "notes-value text-muted";
    }

    // Populate smart notes in the drawer
    const smartNotesList = document.getElementById("drawer-smart-notes-list");
    smartNotesList.innerHTML = "";
    const notesList = getSmartNotes(pat);
    notesList.forEach(note => {
        const item = document.createElement("div");
        item.className = `smart-note-item sn-item-${note.level}`;
        item.innerHTML = `
            <div class="sni-icon"><i class="${note.icon}"></i></div>
            <div class="sni-text">
                <strong>${escapeHTML(note.title)}</strong>
                <p>${escapeHTML(note.description)}</p>
            </div>
        `;
        smartNotesList.appendChild(item);
    });
    
    // Render the Patient Coordination timeline stepper
    renderPatientTimeline(pat);

    // Add backdrop if not present
    let backdrop = document.querySelector(".drawer-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.className = "drawer-backdrop";
        document.body.appendChild(backdrop);
        backdrop.addEventListener("click", closePatientDrawer);
    }
    
    // Show drawer
    const drawer = document.getElementById("patient-details-drawer");
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
}

function closePatientDrawer() {
    const drawer = document.getElementById("patient-details-drawer");
    const backdrop = document.querySelector(".drawer-backdrop");
    
    drawer.classList.add("hidden");
    if (backdrop) {
        backdrop.classList.add("hidden");
    }
}

function setupDrawerClose() {
    const closeBtn = document.getElementById("close-drawer-btn");
    closeBtn.addEventListener("click", closePatientDrawer);
}

// --- Data Visualization (Chart.js) ---
function renderCharts() {
    if (typeof Chart === "undefined") {
        showToast("Chart.js is unavailable. Charts cannot be rendered until the library loads.", "error");
        return;
    }

    // Destroy previous charts if they exist
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
    
    // Extract Chart Theme Configs
    const isDark = document.body.classList.contains("dark-theme");
    const textColor = isDark ? "#e2e8f0" : "#334155";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

    // Chart 1: Patients by Clinic & Division (Stacked Bar)
    const clinicsMap = {};
    patientsData.forEach(pat => {
        const clinic = getPatientVal(pat, 'clinic') || 'Not Specified';
        const division = getPatientVal(pat, 'division') || 'Not Specified';
        if (!clinicsMap[clinic]) clinicsMap[clinic] = { inpatient: 0, outpatient: 0, other: 0 };
        
        if (division.toLowerCase().includes('inpatient')) clinicsMap[clinic].inpatient++;
        else if (division.toLowerCase().includes('outpatient')) clinicsMap[clinic].outpatient++;
        else clinicsMap[clinic].other++;
    });
    
    const clinicLabels = Object.keys(clinicsMap);
    const inpatientData = clinicLabels.map(l => clinicsMap[l].inpatient);
    const outpatientData = clinicLabels.map(l => clinicsMap[l].outpatient);
    const otherDivData = clinicLabels.map(l => clinicsMap[l].other);
    
    const clinicCanvas = document.getElementById('chart-clinic-division');
    const referralCanvas = document.getElementById('chart-referral-status');
    const diagnosesCanvas = document.getElementById('chart-diagnoses');
    const coordinatorsCanvas = document.getElementById('chart-coordinators');
    if (!clinicCanvas || !referralCanvas || !diagnosesCanvas || !coordinatorsCanvas) {
        console.warn("One or more chart canvases are missing from the page.");
        return;
    }

    const ctxClinic = clinicCanvas.getContext('2d');
    charts.clinic = new Chart(ctxClinic, {
        type: 'bar',
        data: {
            labels: clinicLabels,
            datasets: [
                { label: 'Inpatient', data: inpatientData, backgroundColor: '#a855f7' },
                { label: 'Outpatient', data: outpatientData, backgroundColor: '#6366f1' },
                { label: 'Other', data: otherDivData, backgroundColor: '#64748b' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor } },
                y: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { labels: { color: textColor } }
            }
        }
    });

    // Chart 2: Referral Status (Doughnut)
    const refMap = {};
    patientsData.forEach(pat => {
        const ref = getPatientVal(pat, 'treatmentReferralStatus') || 'none';
        refMap[ref] = (refMap[ref] || 0) + 1;
    });
    
    const ctxRef = referralCanvas.getContext('2d');
    charts.referral = new Chart(ctxRef, {
        type: 'doughnut',
        data: {
            labels: Object.keys(refMap),
            datasets: [{
                data: Object.values(refMap),
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#64748b', '#06b6d4', '#4f46e5'],
                borderWidth: 1,
                borderColor: isDark ? '#1e293b' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor } }
            }
        }
    });

    // Chart 3: Top Diagnoses (Horizontal Bar)
    const diagMap = {};
    patientsData.forEach(pat => {
        const diag = getPatientVal(pat, 'diagnosis') || 'Not Specified';
        diagMap[diag] = (diagMap[diag] || 0) + 1;
    });
    
    // Sort and get top 5
    const topDiag = Object.entries(diagMap)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 5);
        
    const diagLabels = topDiag.map(x => x[0]);
    const diagCounts = topDiag.map(x => x[1]);

    const ctxDiag = diagnosesCanvas.getContext('2d');
    charts.diagnoses = new Chart(ctxDiag, {
        type: 'bar',
        data: {
            labels: diagLabels,
            datasets: [{
                label: 'Patient Count',
                data: diagCounts,
                backgroundColor: '#06b6d4'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Chart 4: Patients by Coordinator (Vertical Bar)
    const coordMap = {};
    patientsData.forEach(pat => {
        const coord = getPatientVal(pat, 'coordinator') || 'Not Specified';
        coordMap[coord] = (coordMap[coord] || 0) + 1;
    });
    
    const ctxCoord = coordinatorsCanvas.getContext('2d');
    charts.coordinators = new Chart(ctxCoord, {
        type: 'bar',
        data: {
            labels: Object.keys(coordMap),
            datasets: [{
                label: 'Total Coordinated Cases',
                data: Object.values(coordMap),
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function updateChartsTheme() {
    if (charts.clinic) {
        renderCharts(); // Redraw all with new color context
    }
}

// --- Export to CSV ---
function setupExportButton() {
    const exportBtn = document.getElementById("export-excel-btn");
    exportBtn.addEventListener("click", () => {
        if (filteredPatients.length === 0) {
            showToast("No data to export", "error");
            return;
        }

        // Generate headers (retrieve all Excel keys from key map)
        const headers = Object.keys(patientsData[0] || {});
        
        let csvContent = "\uFEFF"; // UTF-8 BOM to support Arabic
        csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
        
        filteredPatients.forEach(pat => {
            const row = headers.map(h => {
                const val = pat[h] !== undefined ? pat[h].toString() : "";
                return `"${val.replace(/"/g, '""')}"`;
            });
            csvContent += row.join(",") + "\r\n";
        });
        
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        
        const dateStr = new Date().toISOString().slice(0, 10);
        link.setAttribute("href", url);
        link.setAttribute("download", `Coordination_Report_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast(`Successfully exported ${filteredPatients.length} cases to CSV`, "success");
    });
}

// --- Toast Alerts Helpers ---
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let iconClass = "fa-solid fa-circle-info";
    if (type === "success") iconClass = "fa-solid fa-circle-check";
    if (type === "error") iconClass = "fa-solid fa-triangle-exclamation";
    
    toast.innerHTML = `
        <i class="${iconClass}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Automatically remove after 4.5 seconds
    setTimeout(() => {
        toast.style.animation = "slideInLeft 0.3s ease reverse forwards";
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 4500);
}
// --- Smart Analytics: Compute All 6 Counts ---
function computeAnalyticsCounts() {
    const a1 = patientsData.filter(pat => {
        const ref = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        return isPendingValue(ref) && isNoValue(ncm);
    });
    const a2 = patientsData.filter(pat => {
        const ref = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        return isPendingValue(ref) && isYesValue(ncm);
    });
    const a3 = patientsData.filter(pat => {
        const sent = getPatientVal(pat, 'permitSent');
        const status = getPatientVal(pat, 'permitStatus');
        return isYesValue(sent) && (isPendingValue(status) || isEmptyLike(status));
    });
    const a4 = patientsData.filter(pat => {
        const forms = getPatientVal(pat, 'referralForms').toLowerCase();
        const otherRef = getPatientVal(pat, 'otherReferralStatus');
        return !isEmptyLike(forms) && !isNoValue(forms) && isPendingValue(otherRef);
    });
    const a5 = patientsData.filter(pat => {
        const refType = getPatientVal(pat, 'referralType').toLowerCase();
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus');
        return (refType.includes('without') || refType.includes('evaluation') || refType.includes('follow up') || refType.includes('follow-up'))
            && isPendingValue(refStatus);
    });
    const a6 = patientsData.filter(pat => {
        const ncm = getPatientVal(pat, 'ncm');
        const chemo = getPatientVal(pat, 'chemoDate');
        return isYesValue(ncm) && !isValidDateValue(chemo);
    });
    const a7 = patientsData.filter(pat => {
        const chemo = getPatientVal(pat, 'chemoDate');
        const notified = getPatientVal(pat, 'notified');
        return isValidDateValue(chemo) && isNoValue(notified);
    });
    const a8 = patientsData.filter(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        const refType = getPatientVal(pat, 'referralType');
        const chemo = getPatientVal(pat, 'chemoDate');
        return isApprovedValue(refStatus) && isNoValue(ncm) && isTreatmentValue(refType) && !isValidDateValue(chemo);
    });
    const a9 = patientsData.filter(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus');
        const ncm = getPatientVal(pat, 'ncm');
        const refType = getPatientVal(pat, 'referralType');
        const chemo = getPatientVal(pat, 'chemoDate');
        return isApprovedValue(refStatus) && isYesValue(ncm) && isTreatmentValue(refType) && !isValidDateValue(chemo);
    });
    return { a1, a2, a3, a4, a5, a6, a7, a8, a9, total: a1.length + a2.length + a3.length + a4.length + a5.length + a6.length + a7.length + a8.length + a9.length };
}

// --- Render Analytics Tab ---
// --- Analytics Rules Config (centralized rule metadata) ---
const ANALYTICS_RULES = {
    1: {
        title: 'Treatment Referral Pending — Not Yet Referred to NCM',
        icon: 'fa-solid fa-circle-xmark', colorClass: 'icon-amber',
        why: 'Patients appear here when <strong>Treatment Referral Status = Pending</strong> AND <strong>New Cases Meeting (NCM) = No or Empty</strong>.<br>These cases have not yet been presented at the weekly multidisciplinary NCM session. <em>Action: add them to the next NCM meeting before the referral can proceed.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Diagnosis', 'Coordinator', 'Treatment Plan', 'NCM', 'Barrier'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'treatmentPlan', '-')}</td>
            <td><span class="status-pill rejected">${getEscapedPatientVal(pat, 'ncm') || '-'}</span></td>
            <td class="text-danger">${getEscapedPatientVal(pat, 'barrier') || '-'}</td>`
    },
    2: {
        title: 'Treatment Referral Pending — Referred to NCM, Awaiting Decision',
        icon: 'fa-solid fa-clock', colorClass: 'icon-indigo',
        why: 'Patients appear here when <strong>Treatment Referral Status = Pending</strong> AND <strong>New Cases Meeting (NCM) = Yes</strong>.<br>The case was presented at NCM but the referral is still pending formal decision or approval. <em>Action: follow up on NCM decision and update the file.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Diagnosis', 'Coordinator', 'Physician', 'Treatment Plan', 'NCM Decision'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'physician')}</td>
            <td>${getEscapedPatientVal(pat, 'treatmentPlan', '-')}</td>
            <td class="text-indigo"><strong>${getEscapedPatientVal(pat, 'ncmDecision') || '-'}</strong></td>`
    },
    3: {
        title: 'Permit Form Sent — Permit Status Still Pending',
        icon: 'fa-solid fa-passport', colorClass: 'icon-amber',
        why: 'Patients appear here when <strong>Permit Form Sent = Yes</strong> AND <strong>Permit Status = Pending or Empty</strong>.<br>The permit application was submitted but no approval or rejection has been recorded yet. <em>Action: follow up with the permits department to confirm receipt and get a status update.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Coordinator', 'Permit Sent', 'Permit Status', 'Patient Notified'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td><span class="status-pill approved">${getEscapedPatientVal(pat, 'permitSent')}</span></td>
            <td><span class="status-pill pending">${escapeHTML(getPatientVal(pat, 'permitStatus') || '-')}</span></td>
            <td>${getEscapedPatientVal(pat, 'notified', '-')}</td>`
    },
    4: {
        title: 'Referral Forms Sent — Other Referral Status Pending',
        icon: 'fa-solid fa-file-circle-exclamation', colorClass: 'icon-danger',
        why: 'Patients appear here when <strong>Referral Forms Sent ≠ No/Empty</strong> AND <strong>Other Referral Status = Pending</strong>.<br>Referral forms were dispatched but no confirmation or update has been received from the destination department. <em>Action: contact the referral destination to confirm receipt and request a status update.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Coordinator', 'Referral Forms Sent', 'Other Referral Status', 'Treatment Referral Status'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'referralForms')}</td>
            <td><span class="status-pill pending">${getEscapedPatientVal(pat, 'otherReferralStatus')}</span></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'treatmentReferralStatus'))}">${getEscapedPatientVal(pat, 'treatmentReferralStatus', '-')}</span></td>`
    },
    5: {
        title: 'Referral Type: Without/Evaluation — But Status is Pending',
        icon: 'fa-solid fa-person-circle-question', colorClass: 'icon-danger',
        why: 'Patients appear here when <strong>Referral Type = Without / Follow-up / Evaluation</strong> AND <strong>Treatment Referral Status = Pending</strong>.<br>This combination is a data inconsistency — a non-treatment referral should not have a pending treatment referral status. <em>Action: review the medical file and correct the referral type or status.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Diagnosis', 'Referral Type', 'Treatment Referral Status', 'Coordinator'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td style="color:var(--color-warning);font-weight:600;">${getEscapedPatientVal(pat, 'referralType')}</td>
            <td><span class="status-pill pending">${getEscapedPatientVal(pat, 'treatmentReferralStatus')}</span></td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>`
    },
    6: {
        title: 'NCM = Yes — Missing Chemotherapy Appointment Date',
        icon: 'fa-solid fa-calendar-xmark', colorClass: 'icon-amber',
        why: 'Patients appear here when <strong>New Cases Meeting (NCM) = Yes</strong> AND <strong>Chemotherapy Appointment Date is empty or not a valid date</strong>.<br>The case was reviewed by NCM but no chemo session has been scheduled yet. <em>Action: coordinate with the chemotherapy department or pharmacy to book the first session.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Diagnosis', 'Coordinator', 'NCM Decision', 'Chemo Date (Current)'],
        renderCells: (pat) => {
            const chemoRaw = getPatientVal(pat, 'chemoDate');
            const chemoDisplay = chemoRaw && chemoRaw !== '0' ? chemoRaw : '-';
            return `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td>${getEscapedPatientVal(pat, 'ncmDecision', '-')}</td>
            <td style="color:var(--color-warning);font-weight:600;">${escapeHTML(chemoDisplay)}</td>`;
        }
    },
    7: {
        title: 'Chemotherapy Scheduled — Patient Not Yet Notified',
        icon: 'fa-solid fa-bell-slash', colorClass: 'icon-amber',
        why: 'Patients appear here when <strong>Chemotherapy Appointment Date is a valid future date</strong> AND <strong>Patient Notified = No or Empty</strong>.<br>A chemo session has been booked but the patient has not been informed. <em>Action: contact the patient immediately to confirm their appointment date.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Diagnosis', 'Coordinator', 'Chemo Appointment Date', 'Patient Notified'],
        renderCells: (pat) => `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${getEscapedPatientVal(pat, 'diagnosis')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getEscapedPatientVal(pat, 'chemoDate')}</td>
            <td><span class="status-pill rejected">${getEscapedPatientVal(pat, 'notified') || '-'}</span></td>`
    },
    8: {
        title: 'Approved Referral (NCM = No) — No Chemo Appointment Booked',
        icon: 'fa-solid fa-house-medical-circle-exclamation', colorClass: 'icon-danger',
        why: 'Patients appear here when <strong>Treatment Referral Status = Approved</strong> AND <strong>Referral Type = Treatment</strong> AND <strong>NCM = No or Empty</strong> AND <strong>Chemotherapy Date is missing</strong>.<br>The treatment referral was approved without going through NCM, but no chemotherapy session has been scheduled. <em>Action: contact the oncology pharmacy or chemo department (outpatient) / inpatient coordinator (inpatient) to book the first session.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Division', 'Coordinator', 'Required Action'],
        renderCells: (pat) => {
            const div = getPatientVal(pat, 'division');
            const action = div.toLowerCase().includes('inpatient')
                ? 'Book with inpatient coordinator'
                : 'Contact oncology pharmacy / chemo department';
            return `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${escapeHTML(div || '-')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td class="text-danger font-weight-bold">${escapeHTML(action)}</td>`;
        }
    },
    9: {
        title: 'Approved Referral (NCM = Yes) — No Chemo Appointment Booked',
        icon: 'fa-solid fa-clock', colorClass: 'icon-danger',
        why: 'Patients appear here when <strong>Treatment Referral Status = Approved</strong> AND <strong>Referral Type = Treatment</strong> AND <strong>NCM = Yes</strong> AND <strong>Chemotherapy Date is missing</strong>.<br>The case was reviewed by NCM and the referral was approved, but no chemotherapy session has been scheduled yet. <em>Action: contact the oncology pharmacy or chemo department (outpatient) / inpatient coordinator (inpatient) to book the first session.</em>',
        headers: ['Patient Name', 'ID', 'Clinic', 'Division', 'Coordinator', 'Required Action'],
        renderCells: (pat) => {
            const div = getPatientVal(pat, 'division');
            const action = div.toLowerCase().includes('inpatient')
                ? 'Book with inpatient coordinator'
                : 'Contact oncology pharmacy / chemo department';
            return `
            <td><strong>${getEscapedPatientVal(pat, 'name')}</strong></td>
            <td>${getEscapedPatientVal(pat, 'id')}</td>
            <td>${getEscapedPatientVal(pat, 'clinic')}</td>
            <td>${escapeHTML(div || '-')}</td>
            <td>${getEscapedPatientVal(pat, 'coordinator')}</td>
            <td class="text-danger font-weight-bold">${escapeHTML(action)}</td>`;
        }
    }
};

let analyticsResults = {};

function setupAnalyticsModal() {
    // Wire KPI cards to open modal
    for (let i = 1; i <= 9; i++) {
        const card = document.getElementById(`akpi-${i}`);
        if (!card) continue;
        const ruleNum = i;
        card.style.cursor = 'pointer';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', () => openAnalyticsModal(ruleNum));
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAnalyticsModal(ruleNum); }
        });
    }

    // Wire modal close
    const modal = document.getElementById('analytics-modal');
    document.getElementById('close-analytics-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal?.classList.add('hidden'); });

    // Wire "Why?" toggle
    document.getElementById('analytics-modal-why-btn')?.addEventListener('click', () => {
        const panel = document.getElementById('analytics-modal-why-panel');
        const btn   = document.getElementById('analytics-modal-why-btn');
        panel.classList.toggle('hidden');
        btn.classList.toggle('reason-active');
    });

    // Wire modal search
    document.getElementById('analytics-modal-search')?.addEventListener('input', () => {
        renderAnalyticsModalTable();
    });

    // Wire print button
    document.getElementById('analytics-modal-print-btn')?.addEventListener('click', printAnalyticsModal);
}

function printAnalyticsModal() {
    const rule     = ANALYTICS_RULES[_currentModalRule];
    const patients = analyticsResults[`a${_currentModalRule}`] || [];
    const searchVal = (document.getElementById('analytics-modal-search')?.value || '').toLowerCase();

    const filtered = searchVal ? patients.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id   = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    }) : patients;

    if (filtered.length === 0) {
        showToast("No patients to print.", "info");
        return;
    }

    // Determine columns relevant to this rule (from its table headers)
    const relevantKeys = new Set(['name', 'id', 'clinic']);
    rule.headers.forEach(h => {
        const key = getColumnKeyFromHeaderText(h);
        if (key) relevantKeys.add(key);
    });

    // Pre-populate the column picker with relevant columns checked
    const container = document.getElementById("print-column-checkboxes");
    if (!container) return;
    container.innerHTML = "";
    ALL_EXCEL_COLUMNS.forEach(col => {
        const label = document.createElement("label");
        label.className = "column-checkbox-label";
        label.innerHTML = `<input type="checkbox" data-key="${col.key}" ${relevantKeys.has(col.key) ? 'checked' : ''}><span>${col.label}</span>`;
        container.appendChild(label);
    });

    currentPrintConfig.tabName = rule.title;
    currentPrintConfig.patientsToPrint = filtered;

    document.getElementById("print-column-modal").classList.remove("hidden");
}

let _currentModalRule = 1;

function openAnalyticsModal(ruleNum) {
    const rule = ANALYTICS_RULES[ruleNum];
    if (!rule) return;
    _currentModalRule = ruleNum;

    // Populate header
    document.getElementById('analytics-modal-title').textContent = rule.title;
    const iconEl = document.getElementById('analytics-modal-icon-el');
    iconEl.className = `analytics-modal-icon ${rule.colorClass}`;
    iconEl.innerHTML = `<i class="${rule.icon}"></i>`;
    document.getElementById('analytics-modal-why-text').innerHTML = rule.why;

    // Reset "Why?" panel
    document.getElementById('analytics-modal-why-panel').classList.add('hidden');
    document.getElementById('analytics-modal-why-btn').classList.remove('reason-active');

    // Reset search
    document.getElementById('analytics-modal-search').value = '';

    // Set column headers
    const thead = document.getElementById('analytics-modal-thead');
    thead.innerHTML = '<tr>' + rule.headers.map(h => `<th>${escapeHTML(h)}</th>`).join('') + '<th></th></tr>';

    renderAnalyticsModalTable();

    document.getElementById('analytics-modal').classList.remove('hidden');
    document.getElementById('analytics-modal-search').focus();
}

function renderAnalyticsModalTable() {
    const rule     = ANALYTICS_RULES[_currentModalRule];
    const patients = analyticsResults[`a${_currentModalRule}`] || [];
    const searchVal = (document.getElementById('analytics-modal-search')?.value || '').toLowerCase();

    const filtered = searchVal ? patients.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id   = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    }) : patients;

    document.getElementById('analytics-modal-count-label').textContent =
        `${filtered.length} patient${filtered.length !== 1 ? 's' : ''}${searchVal ? ' matching search' : ''}`;

    const tbody = document.getElementById('analytics-modal-tbody');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        const colCount = rule.headers.length + 1;
        tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="table-empty-state"><i class="fa-solid fa-circle-check"></i><h4>No patients</h4><p>${searchVal ? 'No results match your search.' : 'No cases match this filter.'}</p></div></td></tr>`;
        return;
    }

    filtered.forEach(pat => {
        const tr = document.createElement('tr');
        if (hasActiveBarrier(pat)) tr.classList.add('has-barrier');
        tr.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        tr.innerHTML = rule.renderCells(pat) + `<td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>`;
        tr.querySelector('.open-details-btn').addEventListener('click', (e) => { e.stopPropagation(); openPatientDrawer(pat); });
        tr.addEventListener('click', () => openPatientDrawer(pat));
        makeRowInteractive(tr, pat);
        tbody.appendChild(tr);
    });
}

function renderAnalyticsTab() {
    const counts = computeAnalyticsCounts();
    analyticsResults = counts;

    for (let i = 1; i <= 9; i++) {
        const el = document.getElementById(`akpi-val-${i}`);
        if (el) el.innerText = counts[`a${i}`].length;
    }

}

// --- Smart Notes Generation logic ---
function getSmartNotes(pat) {
    const notes = [];
    
    const ref = getPatientVal(pat, 'treatmentReferralStatus');
    const ncm = getPatientVal(pat, 'ncm');
    const sent = getPatientVal(pat, 'permitSent');
    const permitStatus = getPatientVal(pat, 'permitStatus');
    const forms = getPatientVal(pat, 'referralForms');
    const otherRef = getPatientVal(pat, 'otherReferralStatus');
    const refType = getPatientVal(pat, 'referralType');
    const normalizedRefType = normalizeValue(refType);
    const chemo = getPatientVal(pat, 'chemoDate');
    const barrier = getPatientVal(pat, 'barrier');
    
    // Rule 1: Pending + NCM = No/Empty
    if (isPendingValue(ref) && isNoValue(ncm)) {
        notes.push({
            title: "NCM Required",
            description: "Treatment referral status is Pending but the case has not been presented in the New Cases Meeting (NCM = No/Empty). Please present the file in the next meeting.",
            level: "danger",
            chipText: "NCM Required",
            icon: "fa-solid fa-triangle-exclamation"
        });
    }
    
    // Rule 2: Pending + NCM = Yes
    if (isPendingValue(ref) && isYesValue(ncm)) {
        notes.push({
            title: "Awaiting NCM Decision",
            description: "Case has been presented in the New Cases Meeting (NCM = Yes) but treatment referral status remains Pending, awaiting final decision approval.",
            level: "info",
            chipText: "Awaiting NCM",
            icon: "fa-solid fa-clock-rotate-left"
        });
    }
    
    // Rule 3: Permit Form Sent = Yes + Permit Status = Pending/Empty
    if (isYesValue(sent) && (isPendingValue(permitStatus) || isEmptyLike(permitStatus))) {
        notes.push({
            title: "Follow up Permit Request",
            description: "Permit application form was sent (Permit Sent = Yes) but status remains Pending/Empty. Please follow up for clearance.",
            level: "warning",
            chipText: "Permit Pending",
            icon: "fa-solid fa-id-card-clip"
        });
    }
    
    // Rule 4: Referral Forms Sent ≠ No + Other Referral Status = Pending
    if (!isEmptyLike(forms) && !isNoValue(forms) && isPendingValue(otherRef)) {
        notes.push({
            title: "Follow up Other Referral",
            description: "Referral forms were sent but other referral status remains Pending.",
            level: "warning",
            chipText: "Other Referral Pending",
            icon: "fa-solid fa-file-invoice"
        });
    }
    
    // Rule 5: Type = Without/Evaluation + Treatment Referral Status = Pending
    if ((normalizedRefType.includes('without') || normalizedRefType.includes('evaluation') || normalizedRefType.includes('follow up') || normalizedRefType.includes('follow-up')) && isPendingValue(ref)) {
        notes.push({
            title: "Review Pending Referral Type",
            description: "Referral type is (Without / Follow-up / Evaluation) but treatment referral status is Pending. Please review medical file.",
            level: "warning",
            chipText: "Referral Type Pending",
            icon: "fa-solid fa-clipboard-question"
        });
    }

    // Rule 6: NCM = Yes + Chemo Date invalid/empty
    const isValidDate = isValidDateValue(chemo);
    if (isYesValue(ncm) && !isValidDate) {
        notes.push({
            title: "Chemo Session Date Missing",
            description: "Case approved in the New Cases Meeting (NCM = Yes) but first chemotherapy session date is not scheduled yet.",
            level: "danger",
            chipText: "Schedule Chemo Date",
            icon: "fa-solid fa-calendar-xmark"
        });
    }

    // Rule 7: Scheduled Chemo — Notification Pending
    const notified = getPatientVal(pat, 'notified');
    if (isValidDate && isNoValue(notified)) {
        notes.push({
            title: "Scheduled Chemo — Notification Pending",
            description: `Chemotherapy is scheduled for ${chemo} but the patient has not been notified yet.`,
            level: "warning",
            chipText: "Chemo Notified Pending",
            icon: "fa-solid fa-bell-slash"
        });
    }

    // Rule 8: Approved Referral (NCM = No) — Missing Chemo Appointment
    const division = getPatientVal(pat, 'division').toLowerCase().trim();
    if (isApprovedValue(ref) && isNoValue(ncm) && isTreatmentValue(refType) && !isValidDate) {
        let hint = "No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department.";
        if (division.includes('inpatient')) {
            hint = "Book an appointment with the inpatient coordinator.";
        }
        notes.push({
            title: "Approved Referral (NCM = No) — Missing Chemo",
            description: `Treatment referral is approved (NCM is No/Empty) but chemotherapy appointment date is missing. Action: ${hint}`,
            level: "danger",
            chipText: "Chemo Pending (NCM = No)",
            icon: "fa-solid fa-house-medical-circle-exclamation"
        });
    }

    // Rule 9: Approved Referral (NCM = Yes) — Missing Chemo Appointment
    if (isApprovedValue(ref) && isYesValue(ncm) && isTreatmentValue(refType) && !isValidDate) {
        let hint = "No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department.";
        if (division.includes('inpatient')) {
            hint = "Book an appointment with the inpatient coordinator.";
        }
        notes.push({
            title: "Approved Referral (NCM = Yes) — Missing Chemo",
            description: `Treatment referral is approved (NCM is Yes) but chemotherapy appointment date is missing. Action: ${hint}`,
            level: "danger",
            chipText: "Chemo Pending (NCM = Yes)",
            icon: "fa-solid fa-clock"
        });
    }
    
    // Active Barrier warning
    if (hasActiveBarrier(pat)) {
        notes.push({
            title: "Active Barrier Identified",
            description: `An active barrier is preventing treatment or coordination: "${barrier}"`,
            level: "danger",
            chipText: "Active Barrier",
            icon: "fa-solid fa-hand"
        });
    }
    
    // If no notes, it's all good
    if (notes.length === 0) {
        notes.push({
            title: "File Complete",
            description: "All coordination requirements, dates, approvals, and meetings have been completed successfully.",
            level: "ok",
            chipText: "Complete",
            icon: "fa-solid fa-circle-check"
        });
    }
    
    return notes;
}

function generateSmartNotesChips(pat) {
    const notes = getSmartNotes(pat);
    return notes.map(note => {
        return `<span class="smart-note-chip sn-${note.level}" data-tooltip="${escapeHTML(note.description)}"><i class="${note.icon}"></i> ${escapeHTML(note.chipText)}</span>`;
    }).join('');
}

// --- Tab-Specific Search Init ---
function setupTabSearches() {
    const listenToSearch = (inputId, renderFn) => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener("input", () => {
                renderFn();
            });
        }
    };
    
    listenToSearch("followup-search-input", renderFollowupTab);
    listenToSearch("ncm-search-input", renderNcmTab);
    listenToSearch("inpatient-search-input", renderInpatientTab);
    listenToSearch("outpatient-search-input", renderOutpatientTab);
    listenToSearch("barriers-search-input", renderBarriersTab);
    listenToSearch("analytics-search-input", renderAnalyticsTab);
}

// --- Dynamic Print Framework with Column Selection ---
// --- Dynamic Print Framework with Column Selection ---
const ALL_EXCEL_COLUMNS = [
    { key: 'name', label: 'Patient Name' },
    { key: 'id', label: 'National ID' },
    { key: 'file', label: 'File Number' },
    { key: 'clinic', label: 'Clinic' },
    { key: 'visitDate', label: 'Clinic Visit Date' },
    { key: 'division', label: 'Division' },
    { key: 'diagnosis', label: 'Diagnosis' },
    { key: 'coordinator', label: 'Coordinator Name' },
    { key: 'mobile', label: 'Mobile Number' },
    { key: 'physician', label: 'Primary Physician' },
    { key: 'referralType', label: 'Referral Type' },
    { key: 'referralForms', label: 'Referral Forms' },
    { key: 'permitSent', label: 'Permit Form Sent' },
    { key: 'otherAppt', label: 'Other Appointments' },
    { key: 'guidance', label: 'Guidance Status' },
    { key: 'treatmentPlan', label: 'Treatment Plan' },
    { key: 'ncm', label: 'NCM Flag' },
    { key: 'ncmDecision', label: 'NCM Decision' },
    { key: 'treatmentReferralStatus', label: 'Treatment Referral Status' },
    { key: 'otherReferralStatus', label: 'Other Referral Status' },
    { key: 'permitStatus', label: 'Permit Status' },
    { key: 'chemoDate', label: 'Chemo Appointment Date' },
    { key: 'notified', label: 'Patient Notified' },
    { key: 'notifiedOther', label: 'Notified of Other Appts' },
    { key: 'barrier', label: 'Current Barrier/Issue' },
    { key: 'notes', label: 'Notes' },
    { key: 'status', label: 'Case Status' }
];

function getColumnKeyFromHeaderText(headerText) {
    const text = headerText.toLowerCase().trim().replace(/[\u2191\u2193]/g, '').trim();
    if (text === "patient name" || text === "name") return "name";
    if (text === "id" || text.includes("national id") || text.includes("national_id")) return "id";
    if (text.includes("file")) return "file";
    if (text.includes("visit date") || text.includes("visit_date")) return "visitDate";
    if (text === "clinic") return "clinic";
    if (text === "division") return "division";
    if (text === "diagnosis") return "diagnosis";
    if (text === "coordinator" || text.includes("signature")) return "coordinator";
    if (text.includes("mobile") || text.includes("phone")) return "mobile";
    if (text.includes("physician") || text.includes("doctor")) return "physician";
    if (text.includes("referral type")) return "referralType";
    if (text.includes("referral form") || text.includes("referral_forms")) return "referralForms";
    if (text.includes("permit sent") || text.includes("permit form sent")) return "permitSent";
    if (text.includes("other appointment") || text.includes("other appt")) return "otherAppt";
    if (text.includes("guidance")) return "guidance";
    if (text.includes("treatment plan") || text.includes("proposed treatment")) return "treatmentPlan";
    if (text === "ncm" || text.includes("new cases meeting")) return "ncm";
    if (text.includes("ncm decision")) return "ncmDecision";
    if (text === "treatment referral" || text.includes("treatment referral status") || text === "treatment referral status") return "treatmentReferralStatus";
    if (text.includes("other referral status") || text.includes("other_referral_status")) return "otherReferralStatus";
    if (text.includes("permit status") || text === "permit status") return "permitStatus";
    if (text.includes("chemotherapy date") || text.includes("chemo date")) return "chemoDate";
    if (text.includes("patient notified") || text === "notified") return "notified";
    if (text.includes("notified of other")) return "notifiedOther";
    if (text.includes("barrier") || text.includes("current barrier")) return "barrier";
    if (text === "notes" || text.includes("additional notes")) return "notes";
    if (text.includes("case status") || text === "status") return "status";
    return null;
}

let currentPrintConfig = {
    tableId: null,
    tabName: null,
    patientsToPrint: []
};

function setupPrinting() {
    const modal = document.getElementById("print-column-modal");
    const closeBtn = document.getElementById("close-print-modal-btn");
    const cancelBtn = document.getElementById("print-cancel-btn");
    const confirmBtn = document.getElementById("print-confirm-btn");
    
    if (!modal) return;
    
    document.querySelectorAll("[id^='print-']").forEach(btn => {
        if (btn.id === 'print-cancel-btn' || btn.id === 'print-confirm-btn' || btn.id === 'print-column-modal') return;
        
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tableId = btn.getAttribute("data-table-id");
            const tabName = btn.getAttribute("data-tab-name");
            openPrintColumnModal(tableId, tabName);
        });
    });
    
    if (closeBtn) closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    if (cancelBtn) cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));
    
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            executePrintJob();
            modal.classList.add("hidden");
        });
    }
}

function openPrintColumnModal(tableId, tabName) {
    const table = document.getElementById(tableId);
    if (!table) {
        showToast("Error: Target table not found", "error");
        return;
    }
    
    const ths = table.querySelectorAll("thead th");
    const container = document.getElementById("print-column-checkboxes");
    if (!container) return;
    
    container.innerHTML = "";
    
    // Gather visible column keys of the target table
    const visibleKeys = new Set();
    ths.forEach(th => {
        const text = th.innerText.trim();
        const key = getColumnKeyFromHeaderText(text);
        if (key) {
            visibleKeys.add(key);
        }
    });
    
    // Populate the container with ALL columns
    ALL_EXCEL_COLUMNS.forEach(col => {
        const isChecked = visibleKeys.has(col.key);
        const label = document.createElement("label");
        label.className = "column-checkbox-label";
        label.innerHTML = `
            <input type="checkbox" data-key="${col.key}" ${isChecked ? 'checked' : ''}>
            <span>${col.label}</span>
        `;
        container.appendChild(label);
    });
    
    // Scan patient IDs from the tbody rows of the target table
    currentPrintConfig.tableId = tableId;
    currentPrintConfig.tabName = tabName;
    currentPrintConfig.patientsToPrint = [];
    
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach(tr => {
        if (tr.querySelector("td[colspan]")) return;
        
        const patId = tr.getAttribute("data-patient-id");
        let patient = null;
        if (patId && patId !== '-') {
            patient = patientsData.find(p => getPatientVal(p, 'id') === patId);
        }
        if (!patient) {
            const firstTd = tr.querySelector("td");
            if (firstTd) {
                const nameText = firstTd.innerText.trim();
                patient = patientsData.find(p => getPatientVal(p, 'name').trim() === nameText);
            }
        }
        if (patient) {
            currentPrintConfig.patientsToPrint.push(patient);
        }
    });
    
    const modal = document.getElementById("print-column-modal");
    modal.classList.remove("hidden");
}

function executePrintJob() {
    const { tableId, tabName, patientsToPrint } = currentPrintConfig;
    
    const checkedCheckboxes = document.querySelectorAll("#print-column-checkboxes input[type='checkbox']:checked");
    const selectedKeys = Array.from(checkedCheckboxes).map(cb => cb.getAttribute("data-key"));
    
    if (selectedKeys.length === 0) {
        showToast("Please select at least one column to print", "error");
        return;
    }
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        showToast("Error: Popup blocked! Please allow popups for this site.", "error");
        return;
    }
    
    const dateStr = new Date().toLocaleString();
    
    const activeCols = ALL_EXCEL_COLUMNS.filter(c => selectedKeys.includes(c.key));
    
    const tableHeaders = activeCols
        .map(c => `<th>${c.label}</th>`)
        .join("");
        
    let rowsHtml = "";
    patientsToPrint.forEach(pat => {
        let rowCells = "";
        activeCols.forEach(col => {
            let val = escapeHTML(getPatientVal(pat, col.key) || '-');
            if (col.key === 'treatmentReferralStatus' || col.key === 'permitStatus' || col.key === 'status') {
                const badgeClass = getPillClass(val);
                rowCells += `<td><span class="status-text-${badgeClass}">${val}</span></td>`;
            } else if (col.key === 'barrier' && val && val !== '0' && val !== '0.0' && val.toLowerCase() !== 'none' && val.toLowerCase() !== 'no') {
                rowCells += `<td style="color:#dc2626;font-weight:600;">${val}</td>`;
            } else {
                rowCells += `<td>${val}</td>`;
            }
        });
        rowsHtml += `<tr>${rowCells}</tr>`;
    });
    
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Print Report - ${tabName}</title>
        <style>
            @page {
                size: landscape;
                margin: 12mm 15mm;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #222222;
                background-color: #ffffff;
                margin: 0;
                padding: 10px;
                font-size: 9.5pt;
            }
            .header-container {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 2px solid #333333;
                padding-bottom: 12px;
                margin-bottom: 20px;
            }
            .title-section h1 {
                font-size: 20pt;
                margin: 0 0 4px 0;
                color: #1e3a8a;
                font-weight: 700;
            }
            .title-section p {
                font-size: 10pt;
                margin: 0;
                color: #555555;
            }
            .meta-section {
                text-align: right;
                font-size: 9pt;
                color: #666666;
            }
            .meta-section p {
                margin: 2px 0;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
            }
            th, td {
                border: 1px solid #cccccc;
                padding: 8px 10px;
                text-align: left;
                vertical-align: middle;
            }
            th {
                background-color: #f3f4f6;
                color: #1f2937;
                font-weight: 700;
                font-size: 9.5pt;
            }
            tr:nth-child(even) {
                background-color: #fafafa;
            }
            .status-text-approved {
                color: #16a34a;
                font-weight: 600;
            }
            .status-text-pending {
                color: #d97706;
                font-weight: 600;
            }
            .status-text-rejected {
                color: #dc2626;
                font-weight: 600;
            }
            .print-footer {
                margin-top: 30px;
                border-top: 1px solid #dddddd;
                padding-top: 8px;
                font-size: 8pt;
                color: #777777;
                display: flex;
                justify-content: space-between;
            }
        </style>
    </head>
    <body>
        <div class="header-container">
            <div class="title-section">
                <h1>${tabName} Report</h1>
                <p>Oncology Patient Coordination Dashboard</p>
            </div>
            <div class="meta-section">
                <p><strong>Print Date:</strong> ${dateStr}</p>
                <p><strong>Total Cases:</strong> ${patientsToPrint.length}</p>
            </div>
        </div>
        <table>
            <thead>
                <tr>${tableHeaders}</tr>
            </thead>
            <tbody>
                ${rowsHtml || '<tr><td colspan="' + selectedKeys.length + '" style="text-align:center;">No records available to print.</td></tr>'}
            </tbody>
        </table>
        <div class="print-footer">
            <span>Generated from Patient Care Coordination System</span>
            <span>Confidential Medical Information</span>
        </div>
        <script>
            window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
            };
        <\/script>
    </body>
    </html>
    `;
    
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
}

// --- Workflow Guideline / Next Action Hints ---
function getPatientActionHint(pat) {
    const notes = getSmartNotes(pat);
    
    // Sort notes priority: danger, warning, info, ok
    const dangerNotes = notes.filter(n => n.level === 'danger');
    if (dangerNotes.length > 0) {
        const barrierNote = dangerNotes.find(n => n.chipText === 'Active Barrier');
        if (barrierNote) {
            return {
                text: `Urgent: Resolve active barrier/issue to proceed: "${getPatientVal(pat, 'barrier')}". Coordinate with the nursing/medical team.`,
                class: 'hint-danger'
            };
        }
        const ncmNote = dangerNotes.find(n => n.chipText === 'NCM Required');
        if (ncmNote) {
            return {
                text: "Action needed: Register this patient for the upcoming weekly New Cases Meeting (NCM) to align on the treatment plan.",
                class: 'hint-danger'
            };
        }
        const chemoNote = dangerNotes.find(n => n.chipText === 'Schedule Chemo Date');
        if (chemoNote) {
            return {
                text: "Action needed: Contact clinic coordinators or scheduling desk to schedule first chemotherapy appointment date.",
                class: 'hint-danger'
            };
        }
        const chemoPendingNo = dangerNotes.find(n => n.chipText === 'Chemo Pending (NCM = No)');
        if (chemoPendingNo) {
            const division = getPatientVal(pat, 'division').toLowerCase();
            const actionText = division.includes('inpatient') 
                ? "Action needed: Book an appointment with the inpatient coordinator." 
                : "Action needed: No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department.";
            return {
                text: actionText,
                class: 'hint-danger'
            };
        }
        const chemoPendingYes = dangerNotes.find(n => n.chipText === 'Chemo Pending (NCM = Yes)');
        if (chemoPendingYes) {
            const division = getPatientVal(pat, 'division').toLowerCase();
            const actionText = division.includes('inpatient') 
                ? "Action needed: Book an appointment with the inpatient coordinator." 
                : "Action needed: No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department.";
            return {
                text: actionText,
                class: 'hint-danger'
            };
        }
    }
    
    const warningNotes = notes.filter(n => n.level === 'warning');
    if (warningNotes.length > 0) {
        const notifyPending = warningNotes.find(n => n.chipText === 'Chemo Notified Pending');
        if (notifyPending) {
            return {
                text: "Action needed: Notify the patient of their scheduled chemotherapy appointment date.",
                class: 'hint-warning'
            };
        }
        const permitNote = warningNotes.find(n => n.chipText === 'Permit Pending');
        if (permitNote) {
            return {
                text: "Action needed: Contact permit/liaison office to check on status of permit clearance. Notify patient.",
                class: 'hint-warning'
            };
        }
        const otherRefNote = warningNotes.find(n => n.chipText === 'Other Referral Pending');
        if (otherRefNote) {
            return {
                text: "Action needed: Follow up with external center on pending other referral status and update files.",
                class: 'hint-warning'
            };
        }
        const refTypeNote = warningNotes.find(n => n.chipText === 'Referral Type Pending');
        if (refTypeNote) {
            return {
                text: "Review required: Patient referral type is set to Without/Evaluation but referral is pending. Check case requirements.",
                class: 'hint-warning'
            };
        }
    }
    
    const infoNotes = notes.filter(n => n.level === 'info');
    if (infoNotes.length > 0) {
        const awaitingNcm = infoNotes.find(n => n.chipText === 'Awaiting NCM');
        if (awaitingNcm) {
            return {
                text: "Awaiting weekly NCM meeting outcome. Follow up once decision is recorded in tracker.",
                class: 'hint-info'
            };
        }
    }
    
    return {
        text: "All coordination requirements complete. Monitor patient treatment schedule and follow regular follow-ups.",
        class: 'hint-success'
    };
}

// --- Smart Patient Search Dropdown Portal ---
function setupMasterSearchDropdown() {
    const searchInput = document.getElementById("master-search-input");
    const resultsContainer = document.getElementById("master-search-results");
    if (!searchInput || !resultsContainer) return;

    const updateDropdown = () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length < 1) {
            resultsContainer.classList.add("hidden");
            resultsContainer.innerHTML = "";
            return;
        }

        // Filter matching patients
        const matches = patientsData.filter(pat => {
            const name = getPatientVal(pat, 'name').toLowerCase();
            const id = getPatientVal(pat, 'id').toLowerCase();
            const file = getPatientVal(pat, 'file').toLowerCase();
            return name.includes(query) || id.includes(query) || file.includes(query);
        });

        resultsContainer.innerHTML = "";
        
        if (matches.length === 0) {
            const noResults = document.createElement("div");
            noResults.className = "text-center text-muted py-3";
            noResults.style.fontSize = "12px";
            noResults.innerText = "No patients found matching your search. / لم يتم العثور على مرضى مطابقة للبحث.";
            resultsContainer.appendChild(noResults);
            resultsContainer.classList.remove("hidden");
            return;
        }

        // Show top 6 matches
        const topMatches = matches.slice(0, 6);
        topMatches.forEach(pat => {
            const name = getPatientVal(pat, 'name');
            const id = getPatientVal(pat, 'id') || '-';
            const file = getPatientVal(pat, 'file') || '-';
            const caseSt = getPatientVal(pat, 'status') || 'none';
            const trSt = getPatientVal(pat, 'treatmentReferralStatus') || 'none';
            const pmSt = getPatientVal(pat, 'permitStatus') || 'none';
            
            // Create result item
            const item = document.createElement("div");
            item.className = "search-result-item";
            
            // Build header
            const header = document.createElement("div");
            header.className = "search-result-header";
            
            const nameEl = document.createElement("div");
            nameEl.className = "search-result-name";
            nameEl.innerText = name;
            header.appendChild(nameEl);
            
            const metaEl = document.createElement("div");
            metaEl.className = "search-result-meta";
            metaEl.innerHTML = `<span>File: ${escapeHTML(file)}</span> <span>ID: ${escapeHTML(id)}</span>`;
            header.appendChild(metaEl);
            
            item.appendChild(header);
            
            // Build statuses row
            const row = document.createElement("div");
            row.className = "search-result-row";
            
            const badges = document.createElement("div");
            badges.className = "search-result-badges";
            
            if (caseSt && caseSt !== 'none') {
                const b1 = document.createElement("span");
                b1.className = `status-pill ${getPillClass(caseSt)}`;
                b1.innerText = `Case: ${caseSt}`;
                badges.appendChild(b1);
            }
            if (trSt && trSt !== 'none') {
                const b2 = document.createElement("span");
                b2.className = `status-pill ${getPillClass(trSt)}`;
                b2.innerText = `Referral: ${trSt}`;
                badges.appendChild(b2);
            }
            if (pmSt && pmSt !== 'none') {
                const b3 = document.createElement("span");
                b3.className = `status-pill ${getPillClass(pmSt)}`;
                b3.innerText = `Permit: ${pmSt}`;
                badges.appendChild(b3);
            }
            
            row.appendChild(badges);
            
            // View Profile indicator
            const actionBtn = document.createElement("span");
            actionBtn.style.fontSize = "10px";
            actionBtn.style.color = "var(--color-primary)";
            actionBtn.style.fontWeight = "600";
            actionBtn.innerHTML = `<i class="fa-solid fa-eye"></i> View Profile`;
            row.appendChild(actionBtn);
            
            item.appendChild(row);
            
            // Build smart analysis chips
            const analysisList = getSmartNotes(pat);
            if (analysisList.length > 0) {
                const analysisContainer = document.createElement("div");
                analysisContainer.className = "search-result-analysis";
                
                analysisList.forEach(note => {
                    const chip = document.createElement("span");
                    chip.className = `search-analysis-chip ${note.level}`;
                    chip.innerHTML = `<i class="${note.icon}"></i> ${escapeHTML(note.chipText || note.title)}`;
                    analysisContainer.appendChild(chip);
                });
                
                item.appendChild(analysisContainer);
            }
            
            // Click to open patient details drawer
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                openPatientDrawer(pat);
                resultsContainer.classList.add("hidden");
            });
            
            resultsContainer.appendChild(item);
        });
        
        resultsContainer.classList.remove("hidden");
    };

    searchInput.addEventListener("input", updateDropdown);
    searchInput.addEventListener("focus", updateDropdown);

    // Close on click outside
    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add("hidden");
        }
    });

    // Close on Escape key
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            resultsContainer.classList.add("hidden");
            searchInput.blur();
        }
    });
}

// --- Bilingual Patient Search & Case Aggregator Portal ---

const BILINGUAL_LABELS = {
    name: "Patient Name / اسم المريض",
    id: "National ID / رقم الهوية",
    file: "File Number / رقم الملف",
    clinic: "Clinic / العيادة",
    visitDate: "Clinic Visit Date / تاريخ زيارة العيادة",
    division: "Division / القسم",
    diagnosis: "Diagnosis / التشخيص",
    coordinator: "Coordinator / المنسق",
    mobile: "Mobile Number / رقم الهاتف",
    physician: "Treating Physician / الطبيب المعالج",
    referralType: "Referral Type / نوع الإحالة",
    referralForms: "Referral Forms Sent / استمارات الإحالة المرسلة",
    permitSent: "Permit Form Sent / إرسال طلب التصريح",
    otherAppt: "Other Appointments / المواعيد الأخرى",
    guidance: "Guidance Completed / إتمام توجيه المريض",
    treatmentPlan: "Treatment Plan / خطة العلاج",
    ncm: "New Cases Meeting / اجتماع الحالات الجديدة",
    ncmDecision: "NCM Decision / قرار اللجنة",
    treatmentReferralStatus: "Treatment Referral Status / حالة إحالة العلاج",
    otherReferralStatus: "Other Referral Status / حالة الإحالات الأخرى",
    permitStatus: "Permit Status / حالة التصريح",
    chemoDate: "Chemotherapy Appointment Date / موعد العلاج الكيماوي",
    notified: "Patient Notified / إبلاغ المريض",
    notifiedOther: "Notified of Other Appts / إبلاغ المريض بالمواعيد الأخرى",
    barrier: "Current Barrier or Issue / العائق أو المشكلة الحالية",
    notes: "Notes / الملاحظات",
    status: "Case Status / حالة الملف"
};

function getPhoneticOutline(str) {
    if (!str) return "";
    let s = str.toLowerCase().trim();
    
    // Map Arabic characters to English counterparts
    const arabicMap = {
        'أ': 'a', 'إ': 'a', 'آ': 'a', 'ء': 'a', 'ؤ': 'a', 'ئ': 'a', 'ى': 'y', 'ي': 'y', 'ع': 'a', 'ا': 'a',
        'ب': 'b',
        'ت': 't', 'ة': 't', 'ط': 't',
        'ث': 's', 'س': 's', 'ش': 's', 'ص': 's',
        'ج': 'j',
        'ح': 'h', 'خ': 'h', 'ه': 'h',
        'د': 'd', 'ض': 'd', 'ذ': 'd', 'ظ': 'd',
        'ر': 'r',
        'ز': 'z',
        'ف': 'f',
        'ق': 'k', 'ك': 'k',
        'ل': 'l',
        'م': 'm',
        'ن': 'n',
        'و': 'w'
    };
    
    let transliterated = "";
    for (let i = 0; i < s.length; i++) {
        const char = s[i];
        if (arabicMap[char]) {
            transliterated += arabicMap[char];
        } else {
            transliterated += char;
        }
    }
    
    // Normalize English consonants
    transliterated = transliterated
        .replace(/kh/g, 'h')
        .replace(/sh/g, 's')
        .replace(/th/g, 't')
        .replace(/ph/g, 'f')
        .replace(/gh/g, 'g')
        .replace(/c/g, 'k')
        .replace(/q/g, 'k')
        .replace(/x/g, 'ks');
        
    // Strip vowels [aeiouyw] - treat w and y as vowels for phonetic outline
    transliterated = transliterated.replace(/[aeiouyw]/g, '');
    
    // Collapse consecutive duplicate characters
    let collapsed = "";
    for (let i = 0; i < transliterated.length; i++) {
        if (i === 0 || transliterated[i] !== transliterated[i - 1]) {
            collapsed += transliterated[i];
        }
    }
    
    return collapsed.replace(/[^a-z0-9]/g, '');
}

function groupPatients(patients) {
    const groups = {};
    
    patients.forEach(pat => {
        const id = getPatientVal(pat, 'id').trim();
        const file = getPatientVal(pat, 'file').trim();
        const name = getPatientVal(pat, 'name').trim();
        
        let key = "";
        if (id && id !== "0" && id !== "0.0") {
            key = "ID_" + id;
        } else if (file && file !== "0" && file !== "0.0") {
            key = "FILE_" + file;
        } else {
            key = "NAME_" + name;
        }
        
        if (!groups[key]) {
            groups[key] = {
                name: name,
                id: id,
                file: file,
                records: []
            };
        }
        groups[key].records.push(pat);
    });
    
    for (const key in groups) {
        groups[key].records.sort((a, b) => {
            const dateA = getPatientVal(a, 'visitDate');
            const dateB = getPatientVal(b, 'visitDate');
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB.localeCompare(dateA); // Descending (most recent first)
        });
    }
    
    return Object.values(groups);
}

function getInitials(name) {
    if (!name) return "P";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        const first = parts[0][0] || "";
        const last = parts[parts.length - 1][0] || "";
        return (first + last).toUpperCase();
    }
    return name[0].toUpperCase();
}

function renderPatientSearchResults() {
    const searchInput = document.getElementById("patient-search-input");
    const container = document.getElementById("patient-search-results-container");
    if (!container) return;
    
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    if (query.length < 1) {
        container.innerHTML = `
            <div class="search-empty-state">
                <div class="empty-icon"><i class="fa-solid fa-user-magnifying-glass"></i></div>
                <h3>Search Patient Database / ابدأ البحث في قاعدة بيانات المرضى</h3>
                <p>Enter the patient's name (in Arabic or English), National ID, or File Number to search across all records and referral states.</p>
            </div>
        `;
        return;
    }
    
    const phoneticQuery = getPhoneticOutline(query);
    const matches = patientsData.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        
        if (name.includes(query) || id.includes(query) || file.includes(query)) {
            return true;
        }
        
        if (phoneticQuery && phoneticQuery.length > 1) {
            const phoneticName = getPhoneticOutline(name);
            if (phoneticName.includes(phoneticQuery)) {
                return true;
            }
        }
        
        return false;
    });
    
    if (matches.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <div class="empty-icon"><i class="fa-solid fa-circle-xmark text-danger"></i></div>
                <h3>No Results Found / لم يتم العثور على نتائج</h3>
                <p>We couldn't find any patients matching "${query}". Please check your search term or try another query.</p>
            </div>
        `;
        return;
    }
    
    const grouped = groupPatients(matches);
    grouped.sort((a, b) => a.name.localeCompare(b.name));
    
    container.innerHTML = "";
    
    grouped.forEach((group, groupIdx) => {
        const currentCaseStatus = group.records[0] ? getPatientVal(group.records[0], 'status') : '';
        
        // Build unique warnings across all records
        const uniqueWarnings = [];
        const seenWarningTitles = new Set();
        group.records.forEach(pat => {
            const notes = getSmartNotes(pat);
            notes.forEach(note => {
                if (!seenWarningTitles.has(note.title)) {
                    seenWarningTitles.add(note.title);
                    uniqueWarnings.push(note);
                }
            });
        });
        
        let totalWarningsHtml = "";
        if (uniqueWarnings.length > 0) {
            totalWarningsHtml = `
            <div class="patient-profile-analysis-summary">
                <span class="profile-analysis-title"><i class="fa-solid fa-lightbulb text-indigo"></i> Smart Analysis Summary / ملخص التحليل الذكي:</span>
                <div class="profile-analysis-chips">
                    ${uniqueWarnings.map(note => `
                        <span class="smart-note-chip sn-${note.level}" data-tooltip="${escapeHTML(note.description)}">
                            <i class="${note.icon}"></i> ${escapeHTML(note.chipText || note.title)}
                        </span>
                    `).join('')}
                </div>
            </div>
            `;
        } else {
            totalWarningsHtml = `
            <div class="patient-profile-analysis-summary">
                <span class="profile-analysis-title"><i class="fa-solid fa-lightbulb text-green"></i> Smart Analysis / التحليل الذكي:</span>
                <div class="profile-analysis-chips">
                    <span class="smart-note-chip sn-ok" data-tooltip="All coordination steps are clear. No warnings. / جميع خطوات التنسيق سليمة. لا توجد تنبيهات.">
                        <i class="fa-solid fa-circle-check"></i> Clean / سليم
                    </span>
                </div>
            </div>
            `;
        }
        
        // Build cases HTML
        const casesHtml = group.records.map((pat, idx) => {
            const isCurrent = idx === 0;
            const visitDate = getPatientVal(pat, 'visitDate');
            const clinic = getPatientVal(pat, 'clinic');
            const division = getPatientVal(pat, 'division');
            const physician = getPatientVal(pat, 'physician');
            const coordinator = getPatientVal(pat, 'coordinator');
            const referralStatus = getPatientVal(pat, 'treatmentReferralStatus');
            const permitStatus = getPatientVal(pat, 'permitStatus');
            const chemoDate = getPatientVal(pat, 'chemoDate');
            const caseStatus = getPatientVal(pat, 'status');
            const caseId = `case_${groupIdx}_${idx}`;
            
            let fullDataGridHtml = "";
            for (const [key, label] of Object.entries(BILINGUAL_LABELS)) {
                const val = getPatientVal(pat, key);
                let highlightClass = "";
                
                if (key === 'barrier' && hasActiveBarrier(pat)) {
                    highlightClass = "highlight-danger";
                } else if (key === 'chemoDate' && isValidDateValue(val)) {
                    highlightClass = "highlight-success";
                } else if (key === 'treatmentReferralStatus' && isPendingValue(val)) {
                    highlightClass = "highlight-danger";
                }
                
                fullDataGridHtml += `
                <div class="data-field ${highlightClass}">
                    <span class="data-label">${escapeHTML(label)}</span>
                    <span class="data-value">${escapeHTML(val || '-')}</span>
                </div>
                `;
            }
            
            return `
            <div class="case-card ${isCurrent ? 'current-case' : ''}">
                <div class="case-card-header">
                    <div class="case-title">
                        <i class="fa-solid fa-file-medical text-indigo"></i>
                        Referral Case #${group.records.length - idx} / إحالة رقم ${group.records.length - idx}
                        ${isCurrent ? `<span class="case-current-badge">Current Case / الحالي</span>` : ''}
                    </div>
                    <div class="case-date">
                        <i class="fa-solid fa-calendar-day"></i> Visit Date / تاريخ الزيارة: ${escapeHTML(visitDate || 'N/A')}
                    </div>
                </div>
                <div class="case-card-body">
                    <div class="case-field">
                        <span class="label">Clinic / العيادة</span>
                        <span class="value">${escapeHTML(clinic || '-')}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Division / القسم</span>
                        <span class="value">${escapeHTML(division || '-')}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Treating Physician / الطبيب المعالج</span>
                        <span class="value">${escapeHTML(physician || '-')}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Coordinator / المنسق</span>
                        <span class="value">${escapeHTML(coordinator || '-')}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Referral Status / حالة إحالة العلاج</span>
                        <span class="value"><span class="status-pill ${getPillClass(referralStatus)}">${escapeHTML(referralStatus || '-')}</span></span>
                    </div>
                    <div class="case-field">
                        <span class="label">Permit Status / حالة التصريح</span>
                        <span class="value"><span class="status-pill ${getPillClass(permitStatus)}">${escapeHTML(permitStatus || '-')}</span></span>
                    </div>
                    <div class="case-field">
                        <span class="label">Chemo Date / تاريخ الكيماوي</span>
                        <span class="value ${chemoDate ? 'text-green font-weight-bold' : ''}">${escapeHTML(chemoDate || '-')}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Case Status / حالة الملف</span>
                        <span class="value"><span class="status-pill ${getPillClass(caseStatus)}">${escapeHTML(caseStatus || '-')}</span></span>
                    </div>
                </div>
                
                <div class="case-card-footer">
                    <div class="case-footer-left">
                        <span class="profile-analysis-title">Coordination Pathway / مسار التنسيق:</span>
                        ${generateMiniTimelineHTML(pat)}
                    </div>
                    <div class="case-footer-right">
                        <button class="btn btn-secondary btn-sm toggle-details-btn" data-case-id="${caseId}">
                            <i class="fa-solid fa-chevron-down"></i> Show Details / عرض التفاصيل
                        </button>
                        <button class="btn btn-primary btn-sm open-drawer-btn" data-case-id="${caseId}">
                            <i class="fa-solid fa-folder-open"></i> Open Case / فتح السجل
                        </button>
                    </div>
                </div>
                
                <div class="patient-full-data-container hidden" id="details-${caseId}">
                    <div class="patient-full-data-grid">
                        ${fullDataGridHtml}
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        const card = document.createElement("div");
        card.className = "patient-profile-card glass-card";
        card.innerHTML = `
            <div class="patient-profile-header">
                <div class="patient-avatar">
                    ${getInitials(group.name)}
                </div>
                <div class="patient-profile-info">
                    <div class="patient-profile-name-row">
                        <h2>${escapeHTML(group.name)}</h2>
                        <div class="patient-profile-badges">
                            ${group.id ? `<span class="profile-badge id-badge"><i class="fa-solid fa-id-card"></i> ID: ${escapeHTML(group.id)}</span>` : ''}
                            ${group.file ? `<span class="profile-badge file-badge"><i class="fa-solid fa-folder-open"></i> File: ${escapeHTML(group.file)}</span>` : ''}
                        </div>
                    </div>
                    <div class="patient-profile-status-row">
                        <div class="status-summary-item">
                            <span class="label">Total Referral Records / إجمالي سجلات الإحالة:</span>
                            <span class="count-badge">${group.records.length}</span>
                        </div>
                        <div class="status-summary-item">
                            <span class="label">Current Status / الحالة الحالية:</span>
                            <span class="status-pill ${getPillClass(currentCaseStatus)}">${escapeHTML(currentCaseStatus || 'Unknown')}</span>
                        </div>
                    </div>
                </div>
                ${totalWarningsHtml}
            </div>
            
            <div class="patient-referrals-section">
                <h3>Referral Records & Timelines / سجلات ومسارات الإحالة</h3>
                <div class="case-cards-grid">
                    ${casesHtml}
                </div>
            </div>
        `;
        
        card.querySelectorAll(".toggle-details-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const caseId = btn.getAttribute("data-case-id");
                const detailsContainer = card.querySelector(`#details-${caseId}`);
                if (detailsContainer) {
                    const isHidden = detailsContainer.classList.contains("hidden");
                    if (isHidden) {
                        detailsContainer.classList.remove("hidden");
                        btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Hide Details / إخفاء التفاصيل`;
                    } else {
                        detailsContainer.classList.add("hidden");
                        btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Show Details / عرض التفاصيل`;
                    }
                }
            });
        });
        
        card.querySelectorAll(".open-drawer-btn").forEach((btn, idx) => {
            btn.addEventListener("click", () => {
                const patRecord = group.records[idx];
                openPatientDrawer(patRecord);
            });
        });
        
        container.appendChild(card);
    });
}

function setupPatientSearch() {
    const searchInput = document.getElementById("patient-search-input");
    const searchBtn = document.getElementById("patient-search-btn");

    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                renderPatientSearchResults();
            }
        });

        searchInput.addEventListener("input", () => {
            if (searchInput.value.trim().length === 0) {
                renderPatientSearchResults();
            }
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener("click", () => {
            renderPatientSearchResults();
        });
    }
}

// =============================================================================
// WORKFLOW FOLLOW-UP ENGINE
// Business-logic-driven automatic follow-up lists (A through L)
// =============================================================================

function containsTreatmentStr(v) {
    return normalizeValue(v).includes('treatment');
}

function isPermitClearForChemo(v) {
    return isApprovedValue(v) || normalizeValue(v) === 'not required' || isEmptyLike(v);
}

function treatmentPlanIndicatesChemo(v) {
    const n = normalizeValue(v);
    return n.includes('chemotherapy') || n.includes('chemo') || n.includes('protocol') || n.includes('approved');
}

function isNeedsFollowupStatus(v) {
    // empty / "no" / "none" / "لا" = not applicable, no follow-up needed
    if (isNoValue(v)) return false;
    const n = normalizeValue(v);
    return n === 'not sent' || isPendingValue(v) || isRejectedValue(v);
}

function isEffectiveTreatmentReferralApproved(pat) {
    // Condition A: Type patient's referral = Treatment AND Treatment Referral Status = approved
    if (isTreatmentValue(getPatientVal(pat, 'referralType')) &&
        isApprovedValue(getPatientVal(pat, 'treatmentReferralStatus'))) return true;
    // Condition B: Referral forms sent/types contains "treatment" AND Other Referral Status = approved
    if (containsTreatmentStr(getPatientVal(pat, 'referralForms')) &&
        isApprovedValue(getPatientVal(pat, 'otherReferralStatus'))) return true;
    return false;
}

const WF_PROBLEM_LABELS = {
    1: 'Patient notified but chemo date is missing',
    2: 'Chemo date set but no approved treatment referral',
    3: 'Chemo date set but permit status not approved',
    4: 'Treatment referral approved but treatment plan empty',
    5: 'Referral forms sent but other referral status empty',
    6: 'Referral type is Treatment but treatment referral status empty',
    7: 'Permit status approved but permit form not sent',
    8: 'Other appt notified but other referral status is pending/rejected'
};

function getDataProblems(pat) {
    const problems = [];
    const refType      = getPatientVal(pat, 'referralType');
    const treatStatus  = getPatientVal(pat, 'treatmentReferralStatus');
    const forms        = getPatientVal(pat, 'referralForms');
    const otherStatus  = getPatientVal(pat, 'otherReferralStatus');
    const otherAppt    = getPatientVal(pat, 'otherAppt');
    const permitSent   = getPatientVal(pat, 'permitSent');
    const permitStatus = getPatientVal(pat, 'permitStatus');
    const chemoDate    = getPatientVal(pat, 'chemoDate');
    const notified     = getPatientVal(pat, 'notified');
    const notifiedOther= getPatientVal(pat, 'notifiedOther');
    const treatPlan    = getPatientVal(pat, 'treatmentPlan');
    const eTRA         = isEffectiveTreatmentReferralApproved(pat);
    const psN          = normalizeValue(permitStatus);

    if (isYesValue(notified) && isEmptyLike(chemoDate)) problems.push(1);
    if (!isEmptyLike(chemoDate) && !eTRA) problems.push(2);
    if (!isEmptyLike(chemoDate) && (isPendingValue(permitStatus) || isRejectedValue(permitStatus) || psN === 'not sent')) problems.push(3);
    if (eTRA && isEmptyLike(treatPlan)) problems.push(4);
    if (!isEmptyLike(forms) && isEmptyLike(otherStatus)) problems.push(5);
    if (isTreatmentValue(refType) && isEmptyLike(treatStatus)) problems.push(6);
    if (isApprovedValue(permitStatus) && (isNoValue(permitSent) || normalizeValue(permitSent) === 'not sent')) problems.push(7);
    if (!isEmptyLike(otherAppt) && isYesValue(notifiedOther) &&
        (isPendingValue(otherStatus) || isRejectedValue(otherStatus) || normalizeValue(otherStatus) === 'not sent')) problems.push(8);
    return problems;
}

function getPatientWorkflowLists(pat) {
    const lists = new Set();
    const refType      = getPatientVal(pat, 'referralType');
    const treatStatus  = getPatientVal(pat, 'treatmentReferralStatus');
    const forms        = getPatientVal(pat, 'referralForms');
    const otherStatus  = getPatientVal(pat, 'otherReferralStatus');
    const permitSent   = getPatientVal(pat, 'permitSent');
    const otherAppt    = getPatientVal(pat, 'otherAppt');
    const guidance     = getPatientVal(pat, 'guidance');
    const treatPlan    = getPatientVal(pat, 'treatmentPlan');
    const ncm          = getPatientVal(pat, 'ncm');
    const permitStatus = getPatientVal(pat, 'permitStatus');
    const chemoDate    = getPatientVal(pat, 'chemoDate');
    const notified     = getPatientVal(pat, 'notified');
    const notifiedOther= getPatientVal(pat, 'notifiedOther');
    const eTRA         = isEffectiveTreatmentReferralApproved(pat);

    // A: Treatment Referral Follow-up
    if ((isTreatmentValue(refType) && isNeedsFollowupStatus(treatStatus)) ||
        (containsTreatmentStr(forms) && isNeedsFollowupStatus(otherStatus))) lists.add('A');

    // B: Other Referral Follow-up
    if (!isEmptyLike(forms) && !containsTreatmentStr(forms) && isNeedsFollowupStatus(otherStatus)) lists.add('B');

    // C: Treatment Plan Missing
    if (eTRA && isEmptyLike(treatPlan)) lists.add('C');

    // D: Permit Form Needed
    if (eTRA && !isEmptyLike(treatPlan) && isNeedsFollowupStatus(permitSent)) lists.add('D');

    // E: Permit Follow-up
    if (eTRA && !isEmptyLike(treatPlan) && isNeedsFollowupStatus(permitStatus)) lists.add('E');

    // F: Needs Chemotherapy Appointment
    if (eTRA && !isEmptyLike(treatPlan) && treatmentPlanIndicatesChemo(treatPlan) &&
        isPermitClearForChemo(permitStatus) && isEmptyLike(chemoDate)) lists.add('F');

    // G: Patient Notification — chemo date set but patient not notified
    if (!isEmptyLike(chemoDate) && isNeedsFollowupStatus(notified)) lists.add('G');

    // H: Other Appointment Notification
    if (!isEmptyLike(otherAppt) && isNeedsFollowupStatus(notifiedOther)) lists.add('H');

    // I: Patient Guidance Follow-up
    if (eTRA && isNeedsFollowupStatus(guidance)) lists.add('I');

    // J: New Cases Meeting list (informational — does NOT block any other list)
    if (isYesValue(ncm)) lists.add('J');

    // K: Completed — all major pathway steps done
    if (eTRA && !isEmptyLike(treatPlan) && isPermitClearForChemo(permitStatus) &&
        !isEmptyLike(chemoDate) && isYesValue(notified) && isYesValue(guidance)) lists.add('K');

    // L: Data Problems
    if (getDataProblems(pat).length > 0) lists.add('L');

    return lists;
}

let workflowResults = {};
let _currentWorkflowList = 'A';

function computeWorkflowCounts() {
    const results = {};
    for (const id of 'ABCDEFGHIJKL') results[id] = [];
    patientsData.forEach(pat => {
        getPatientWorkflowLists(pat).forEach(id => results[id].push(pat));
    });
    return results;
}

// --- Action label helpers ---

function _wfTreatRefAction(pat) {
    const refType = getPatientVal(pat, 'referralType');
    const s = isTreatmentValue(refType)
        ? getPatientVal(pat, 'treatmentReferralStatus')
        : getPatientVal(pat, 'otherReferralStatus');
    if (isPendingValue(s)) return 'Follow treatment referral approval';
    if (isRejectedValue(s)) return 'Escalate or review rejection';
    return 'Send treatment referral';
}

function _wfOtherRefAction(pat) {
    const s = getPatientVal(pat, 'otherReferralStatus');
    if (isPendingValue(s)) return 'Follow referral approval';
    if (isRejectedValue(s)) return 'Escalate or review rejection';
    return 'Send referral form';
}

function _wfPermitAction(pat) {
    const s = getPatientVal(pat, 'permitStatus');
    if (isPendingValue(s)) return 'Follow permit approval';
    if (isRejectedValue(s)) return 'Escalate or resubmit permit';
    return 'Send or confirm permit form';
}

// --- WORKFLOW_LISTS configuration ---

const WORKFLOW_LISTS = {
    A: {
        title: "A. Treatment Referral Follow-up",
        icon: "fa-solid fa-file-medical",
        colorClass: "icon-danger",
        why: "Patients appear when <strong>Type patient's referral = Treatment</strong> AND <strong>Treatment Referral Status</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em> — OR when <strong>Referral forms sent/types contains \"Treatment\"</strong> AND <strong>Other Referral Status</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = pathway not applicable to this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Referral Type", "Treatment Ref. Status", "Forms Sent", "Other Ref. Status", "Action Needed"],
        renderCells: (pat) => {
            const action = _wfTreatRefAction(pat);
            const ts = getPatientVal(pat, 'treatmentReferralStatus');
            const os = getPatientVal(pat, 'otherReferralStatus');
            const actionClass = (isPendingValue(ts) || isPendingValue(os)) ? 'text-indigo'
                              : (isRejectedValue(ts) || isRejectedValue(os)) ? 'text-danger'
                              : 'text-warning';
            return `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'referralType','-')}</td>
                <td><span class="status-pill ${getPillClass(ts)}">${escapeHTML(ts||'-')}</span></td>
                <td>${getEscapedPatientVal(pat,'referralForms','-')}</td>
                <td><span class="status-pill ${getPillClass(os)}">${escapeHTML(os||'-')}</span></td>
                <td class="${actionClass}"><strong>${escapeHTML(action)}</strong></td>`;
        }
    },
    B: {
        title: "B. Other Referral Follow-up",
        icon: "fa-solid fa-file-circle-exclamation",
        colorClass: "icon-amber",
        why: "Patients appear when <strong>Referral forms sent/types</strong> is not empty, does <em>not</em> contain \"Treatment\", AND <strong>Other Referral Status</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = no referral follow-up needed for this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Forms Sent", "Other Referral Status", "Action Needed"],
        renderCells: (pat) => {
            const action = _wfOtherRefAction(pat);
            const os = getPatientVal(pat, 'otherReferralStatus');
            const actionClass = isPendingValue(os) ? 'text-indigo' : isRejectedValue(os) ? 'text-danger' : 'text-warning';
            return `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'referralForms')}</td>
                <td><span class="status-pill ${getPillClass(os)}">${escapeHTML(os||'-')}</span></td>
                <td class="${actionClass}"><strong>${escapeHTML(action)}</strong></td>`;
        }
    },
    C: {
        title: "C. Treatment Plan Missing",
        icon: "fa-solid fa-clipboard-question",
        colorClass: "icon-amber",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong> (via either pathway) AND <strong>Treatment Plan is empty</strong>. A treatment plan must be documented before the permit and chemotherapy booking steps can proceed.",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Referral Type", "Effective Referral Status", "Action Needed"],
        renderCells: (pat) => {
            const rt = getPatientVal(pat, 'referralType');
            const effStatus = isTreatmentValue(rt)
                ? getPatientVal(pat, 'treatmentReferralStatus')
                : getPatientVal(pat, 'otherReferralStatus');
            return `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'referralType','-')}</td>
                <td><span class="status-pill approved">${escapeHTML(effStatus||'Approved')}</span></td>
                <td class="text-warning"><strong>Ask physician to complete the treatment plan</strong></td>`;
        }
    },
    D: {
        title: "D. Permit Form Needed",
        icon: "fa-solid fa-passport",
        colorClass: "icon-amber",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong>, <strong>Treatment Plan is filled</strong>, AND <strong>Permit form sent</strong> is explicitly <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = permit not required for this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Treatment Plan", "Permit Form Sent", "Action Needed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'treatmentPlan','-')}</td>
                <td><span class="status-pill rejected">${getEscapedPatientVal(pat,'permitSent','Not sent')}</span></td>
                <td class="text-warning"><strong>Send permit form</strong></td>`
    },
    E: {
        title: "E. Permit Follow-up",
        icon: "fa-solid fa-stamp",
        colorClass: "icon-amber",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong>, Treatment Plan is filled, AND <strong>Permit Status</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = permit not required or not applicable — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Treatment Plan", "Permit Sent", "Permit Status", "Action Needed"],
        renderCells: (pat) => {
            const action = _wfPermitAction(pat);
            const ps = getPatientVal(pat, 'permitStatus');
            const actionClass = isPendingValue(ps) ? 'text-indigo' : isRejectedValue(ps) ? 'text-danger' : 'text-warning';
            return `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'treatmentPlan','-')}</td>
                <td>${getEscapedPatientVal(pat,'permitSent','-')}</td>
                <td><span class="status-pill ${getPillClass(ps)}">${escapeHTML(ps||'-')}</span></td>
                <td class="${actionClass}"><strong>${escapeHTML(action)}</strong></td>`;
        }
    },
    F: {
        title: "F. Needs Chemotherapy Appointment",
        icon: "fa-solid fa-syringe",
        colorClass: "icon-danger",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong>, Treatment Plan contains chemo/protocol keywords, <strong>Permit Status is approved, not required, or empty</strong> (i.e. permit is cleared or not needed), AND <strong>Chemotherapy Appointment Date is empty</strong>.<br><em>New Cases Meeting does NOT block this rule — NCM is informational only.</em>",
        headers: ["Patient Name", "ID", "Clinic", "Division", "Coordinator", "Treatment Plan", "Permit Status", "Action Needed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'division','-')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'treatmentPlan','-')}</td>
                <td><span class="status-pill approved">${getEscapedPatientVal(pat,'permitStatus','Cleared')}</span></td>
                <td class="text-danger"><strong>Book chemotherapy appointment</strong></td>`
    },
    G: {
        title: "G. Patient Notification — Chemo",
        icon: "fa-solid fa-bell-slash",
        colorClass: "icon-amber",
        why: "Patients appear when <strong>Chemotherapy Appointment Date is not empty</strong> AND <strong>Patient Notified</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = notification not applicable for this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Chemo Appointment Date", "Patient Notified", "Action Needed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td class="text-green"><strong>${getEscapedPatientVal(pat,'chemoDate')}</strong></td>
                <td><span class="status-pill rejected">${getEscapedPatientVal(pat,'notified','Not notified')}</span></td>
                <td class="text-warning"><strong>Notify patient of chemo appointment</strong></td>`
    },
    H: {
        title: "H. Other Appointment Notification",
        icon: "fa-solid fa-calendar-check",
        colorClass: "icon-indigo",
        why: "Patients appear when <strong>Other Appointments and date</strong> is not empty AND <strong>Patient Notified of other appointments</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = notification not applicable for this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Other Appointments", "Notified of Other Appt", "Action Needed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td>${getEscapedPatientVal(pat,'otherAppt')}</td>
                <td><span class="status-pill rejected">${getEscapedPatientVal(pat,'notifiedOther','Not notified')}</span></td>
                <td class="text-indigo"><strong>Notify patient of other appointment</strong></td>`
    },
    I: {
        title: "I. Patient Guidance Follow-up",
        icon: "fa-solid fa-person-chalkboard",
        colorClass: "icon-indigo",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong> AND <strong>Patient Guidance Completed</strong> is <em>not sent</em>, <em>pending</em>, or <em>rejected</em>.<br><strong>Empty / no / none = guidance not applicable for this patient — excluded.</strong>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Patient Guidance Completed", "Action Needed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td><span class="status-pill pending">${getEscapedPatientVal(pat,'guidance','Not completed')}</span></td>
                <td class="text-indigo"><strong>Complete patient guidance / education</strong></td>`
    },
    J: {
        title: "J. New Cases Meeting List",
        icon: "fa-solid fa-user-doctor",
        colorClass: "icon-indigo",
        why: "<strong>Informational list only.</strong> Patients appear when <strong>New Cases Meeting = Yes</strong>. Patients here may simultaneously appear in any other follow-up list. New Cases Meeting does NOT block chemotherapy booking or any other workflow step.",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "NCM Decision", "Treatment Plan", "Chemo Date", "Case Status"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td class="text-indigo"><strong>${getEscapedPatientVal(pat,'ncmDecision','-')}</strong></td>
                <td>${getEscapedPatientVal(pat,'treatmentPlan','-')}</td>
                <td>${getEscapedPatientVal(pat,'chemoDate','-')}</td>
                <td><span class="status-pill ${getPillClass(getPatientVal(pat,'status'))}">${getEscapedPatientVal(pat,'status','-')}</span></td>`
    },
    K: {
        title: "K. Completed — No Follow-up Needed",
        icon: "fa-solid fa-circle-check",
        colorClass: "icon-green",
        why: "Patients appear when <strong>Effective Treatment Referral is Approved</strong>, Treatment Plan is filled, Permit is cleared (approved / not required / none), <strong>Chemotherapy Date is set</strong>, <strong>Patient Notified = Yes</strong>, AND <strong>Patient Guidance Completed = Yes</strong>. All major pathway steps are complete.",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Chemo Date", "Patient Notified", "Guidance Completed"],
        renderCells: (pat) => `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td class="text-green"><strong>${getEscapedPatientVal(pat,'chemoDate')}</strong></td>
                <td><span class="status-pill approved">${getEscapedPatientVal(pat,'notified')}</span></td>
                <td><span class="status-pill approved">${getEscapedPatientVal(pat,'guidance')}</span></td>`
    },
    L: {
        title: "L. Data Problems / Inconsistency",
        icon: "fa-solid fa-triangle-exclamation",
        colorClass: "icon-danger",
        why: "Patients appear when any of 8 data inconsistency conditions fire — e.g., notified without chemo date, chemo date without approved referral, permit approved but not sent, etc. <em>Review and correct the patient record.</em>",
        headers: ["Patient Name", "ID", "Clinic", "Coordinator", "Data Issues Found"],
        renderCells: (pat) => {
            const issues = getDataProblems(pat).map(n => WF_PROBLEM_LABELS[n]).join(' &bull; ');
            return `<td><strong>${getEscapedPatientVal(pat,'name')}</strong></td>
                <td>${getEscapedPatientVal(pat,'id')}</td>
                <td>${getEscapedPatientVal(pat,'clinic')}</td>
                <td>${getEscapedPatientVal(pat,'coordinator')}</td>
                <td class="text-danger" style="max-width:360px;white-space:normal;line-height:1.4;">${issues}</td>`;
        }
    }
};

// --- Render / Tab ---

function renderWorkflowTab() {
    const counts = computeWorkflowCounts();
    workflowResults = counts;
    for (const id of 'ABCDEFGHIJKL') {
        const el = document.getElementById(`wkpi-val-${id}`);
        if (el) el.innerText = (counts[id] || []).length;
    }
}

// --- Modal ---

function setupWorkflowModal() {
    for (const id of 'ABCDEFGHIJKL') {
        const card = document.getElementById(`wkpi-${id}`);
        if (!card) continue;
        card.addEventListener('click', () => openWorkflowModal(id));
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWorkflowModal(id); }
        });
    }

    const modal = document.getElementById('workflow-modal');
    document.getElementById('close-workflow-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    document.getElementById('workflow-modal-why-btn')?.addEventListener('click', () => {
        document.getElementById('workflow-modal-why-panel').classList.toggle('hidden');
        document.getElementById('workflow-modal-why-btn').classList.toggle('reason-active');
    });

    document.getElementById('workflow-modal-search')?.addEventListener('input', renderWorkflowModalTable);
    document.getElementById('workflow-modal-print-btn')?.addEventListener('click', printWorkflowModal);
}

function openWorkflowModal(listId) {
    const list = WORKFLOW_LISTS[listId];
    if (!list) return;
    _currentWorkflowList = listId;

    document.getElementById('workflow-modal-title').textContent = list.title;
    const iconEl = document.getElementById('workflow-modal-icon-el');
    iconEl.className = `analytics-modal-icon ${list.colorClass}`;
    iconEl.innerHTML = `<i class="${list.icon}"></i>`;
    document.getElementById('workflow-modal-why-text').innerHTML = list.why;

    document.getElementById('workflow-modal-why-panel')?.classList.add('hidden');
    document.getElementById('workflow-modal-why-btn')?.classList.remove('reason-active');

    const thead = document.getElementById('workflow-modal-thead');
    thead.innerHTML = '<tr>' + list.headers.map(h => `<th>${escapeHTML(h)}</th>`).join('') + '<th></th></tr>';

    if (document.getElementById('workflow-modal-search')) document.getElementById('workflow-modal-search').value = '';
    renderWorkflowModalTable();

    document.getElementById('workflow-modal').classList.remove('hidden');
}

function renderWorkflowModalTable() {
    const list     = WORKFLOW_LISTS[_currentWorkflowList];
    const patients = workflowResults[_currentWorkflowList] || [];
    const searchVal = (document.getElementById('workflow-modal-search')?.value || '').toLowerCase();

    const filtered = searchVal ? patients.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id   = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    }) : patients;

    const countLabel = document.getElementById('workflow-modal-count-label');
    if (countLabel) countLabel.textContent = `${filtered.length} patient${filtered.length !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('workflow-modal-tbody');
    if (filtered.length === 0) {
        const colCount = list.headers.length + 1;
        tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="table-empty-state"><i class="fa-solid fa-circle-check"></i><h4>No patients</h4><p>${searchVal ? 'No results match your search.' : 'No cases match this filter.'}</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    filtered.forEach(pat => {
        const tr = document.createElement('tr');
        if (hasActiveBarrier(pat)) tr.classList.add('has-barrier');
        tr.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        tr.innerHTML = list.renderCells(pat) + `<td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>`;
        tr.querySelector('.open-details-btn').addEventListener('click', e => { e.stopPropagation(); openPatientDrawer(pat); });
        tr.addEventListener('click', () => openPatientDrawer(pat));
        tbody.appendChild(tr);
    });
}

function printWorkflowModal() {
    const list     = WORKFLOW_LISTS[_currentWorkflowList];
    const patients = workflowResults[_currentWorkflowList] || [];
    const searchVal = (document.getElementById('workflow-modal-search')?.value || '').toLowerCase();
    const filtered  = searchVal ? patients.filter(pat => {
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id   = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    }) : patients;

    if (filtered.length === 0) { showToast("No patients to print.", "info"); return; }

    const relevantKeys = new Set(['name', 'id', 'clinic']);
    list.headers.forEach(h => { const key = getColumnKeyFromHeaderText(h); if (key) relevantKeys.add(key); });

    const container = document.getElementById("print-column-checkboxes");
    if (!container) return;
    container.innerHTML = "";
    ALL_EXCEL_COLUMNS.forEach(col => {
        const label = document.createElement("label");
        label.className = "column-checkbox-label";
        label.innerHTML = `<input type="checkbox" data-key="${col.key}" ${relevantKeys.has(col.key) ? 'checked' : ''}><span>${col.label}</span>`;
        container.appendChild(label);
    });

    currentPrintConfig.tabName = list.title;
    currentPrintConfig.patientsToPrint = filtered;
    document.getElementById("print-column-modal").classList.remove("hidden");
}


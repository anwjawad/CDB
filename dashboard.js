// --- Global State ---
let patientsData = [];
let dropdownLists = {};
let filteredPatients = [];
let charts = {};
let currentSort = { column: 'Patient Name', direction: 'asc' };
let pagination = { currentPage: 1, pageSize: 25 };
let currentQuickFilter = 'all';

// --- Key Mapping Configuration for Excel Headers ---
const KEY_MAP = {
    name: ['Patient Name', 'PatientName', 'اسم المريض'],
    id: ['ID', 'Id', 'الهوية', 'رقم الهوية', ' ID'],
    file: ['File Number', 'FileNumber', 'رقم الملف'],
    clinic: ['Clinic', 'العيادة'],
    visitDate: ['Date of clinic visit', 'Date of clinic visit ', 'تاريخ زيارة العيادة'],
    division: ['Division', 'Division ', 'القسم'],
    diagnosis: ['Diagnosis', 'التشخيص'],
    coordinator: ['Coordinator/ Clinic Nurse', 'Coordinator', 'المنسق', 'Coordinator/ Clinic Nurse Signature'],
    mobile: ['Patient Mobile', 'رقم الهاتف'],
    physician: ['Primary Physician', 'الطبيب المعالج'],
    referralType: ["Type patient's referral", "Type patient's referral ", "Type patient's referral"],
    referralForms: ['Referral forms sent/types', 'Referral forms sent/types '],
    permitSent: ['Permit form sent', 'Permit form sent '],
    otherAppt: ['Other Appointments and date', 'Other Appointment date', 'Other Appointments and date'],
    guidance: ['Patient Guidance Completed'],
    treatmentPlan: ['Treatment Plan'],
    ncm: ['New Cases Meeting'],
    ncmDecision: ['New Cases Meeting decision', 'New Cases Meeting decision '],
    treatmentReferralStatus: ['Treatment Referral Status'],
    otherReferralStatus: ['Other Referral Status'],
    permitStatus: ['Permit Status'],
    chemoDate: ['chemotherapy Appointment Date', 'chemotherapy Appointment Date '],
    notified: ['Patient Notified'],
    notifiedOther: ['Patient Notified of other appointments'],
    barrier: ['Current Barrier/Issue', 'Current Barrier/Issue ', 'Current Barrier / Issue'],
    notes: ['Notes'],
    status: ['Case Status', 'Status', 'حالة الملف']
};

function getPatientVal(pat, type) {
    const keys = KEY_MAP[type];
    if (!keys) return "";
    for (const key of keys) {
        if (pat[key] !== undefined && pat[key] !== null) {
            return pat[key].toString().trim();
        }
    }
    return "";
}

function hasActiveBarrier(pat) {
    const barrier = getPatientVal(pat, 'barrier').trim();
    return barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no';
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

        if (refStatus === 'pending' || refStatus === 'قيد الانتظار' || refStatus === 'معلق') pending++;
        if (ncm === 'yes' || ncm === 'نعم') ncmCount++;
        if (permitSent === 'yes' || permitSent === 'نعم') permitCount++;
        if (chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo)) chemoScheduled++;
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
    const refStatus = refStatusRaw.toLowerCase();
    
    const ncmFlagRaw = getPatientVal(pat, 'ncm').trim();
    const ncmFlag = ncmFlagRaw.toLowerCase();
    const ncmDecision = getPatientVal(pat, 'ncmDecision').trim();
    
    const permitSentRaw = getPatientVal(pat, 'permitSent').trim();
    const permitSent = permitSentRaw.toLowerCase();
    const permitStatusRaw = getPatientVal(pat, 'permitStatus').trim();
    const permitStatus = permitStatusRaw.toLowerCase();
    
    const chemoDate = getPatientVal(pat, 'chemoDate').trim();
    const isChemoScheduled = chemoDate && /^\d{4}-\d{2}-\d{2}$/.test(chemoDate);
    
    const notifiedRaw = getPatientVal(pat, 'notified').trim();
    const notified = notifiedRaw.toLowerCase();

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
        if (refStatus === 'pending') {
            step2.state = "pending";
            step2.desc = "Referral submitted, pending review";
            step2.icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        } else if (refStatus === 'approved' || refStatus === 'yes' || refStatus === 'تم التنسيق' || refStatus === 'موافق عليه') {
            step2.state = "completed";
            step2.desc = `Referral approved (${refStatusRaw})`;
            step2.icon = '<i class="fa-solid fa-circle-check"></i>';
        } else if (refStatus === 'rejected' || refStatus === 'no' || refStatus === 'مرفوض') {
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
    if (ncmFlag === 'yes' || ncmFlag === 'نعم') {
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
    if (permitSent === 'yes' || permitSent === 'نعم') {
        if (permitStatus === 'approved' || permitStatus === 'موافق عليه' || permitStatus === 'تم التنسيق' || permitStatus === 'yes' || permitStatus === 'نعم') {
            step4.state = "completed";
            step4.desc = `Permit approved: ${permitStatusRaw}`;
            step4.icon = '<i class="fa-solid fa-circle-check"></i>';
        } else if (permitStatus === 'rejected' || permitStatus === 'مرفوض' || permitStatus === 'no' || permitStatus === 'لا') {
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
    if (notified === 'yes' || notified === 'نعم') {
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
                <span class="barrier-pulse-badge" title="Active Barrier: ${getPatientVal(pat, 'barrier')}"></span>
                <strong>${name}</strong>
            </div>
        `;
    }
    return `<strong>${name}</strong>`;
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
                const pill = document.querySelector(".pill-btn[data-filter='all']");
                if (pill) {
                    pill.click();
                }
                switchToMasterTab();
            });
        }
    }
    if (kpiActive) {
        const card = kpiActive.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                const pill = document.querySelector(".pill-btn[data-filter='all']");
                if (pill) {
                    pill.click();
                }
                switchToMasterTab();
            });
        }
    }
    if (kpiPending) {
        const card = kpiPending.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                const pill = document.querySelector(".pill-btn[data-filter='pending-referrals']");
                if (pill) {
                    pill.click();
                }
                switchToMasterTab();
            });
        }
    }
    if (kpiNcm) {
        const card = kpiNcm.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                const pill = document.querySelector(".pill-btn[data-filter='ncm-cases']");
                if (pill) {
                    pill.click();
                }
                switchToMasterTab();
            });
        }
    }
    if (kpiBarriers) {
        const card = kpiBarriers.closest(".kpi-card");
        if (card) {
            card.addEventListener("click", () => {
                const pill = document.querySelector(".pill-btn[data-filter='barriers']");
                if (pill) {
                    pill.click();
                }
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

            // Find matching pill
            const pillBtns = document.querySelectorAll(".pill-btn");
            let foundPill = false;
            pillBtns.forEach(btn => {
                if (btn.getAttribute("data-filter") === filterName) {
                    btn.click();
                    foundPill = true;
                }
            });

            if (!foundPill && filterName === 'chemo-scheduled') {
                // special case since there is no pill for chemo-scheduled,
                // we remove active class from all pills and set currentQuickFilter directly
                pillBtns.forEach(btn => btn.classList.remove("active"));
                currentQuickFilter = 'chemo-scheduled';
                pagination.currentPage = 1;
                applyFilters();
            }

            switchToMasterTab();
        });
    });
}


// --- App Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
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
    
    // Fetch configuration and initial data
    fetchConfig();
    loadDashboardData();
}

// --- Theme Toggle ---
function setupThemeToggle() {
    const themeBtn = document.getElementById("theme-toggle-btn");
    
    // Check local storage or defaults
    const currentTheme = localStorage.getItem("theme") || "dark";
    if (currentTheme === "light") {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.add("dark-theme");
        document.body.classList.remove("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }

    themeBtn.addEventListener("click", () => {
        if (document.body.classList.contains("dark-theme")) {
            document.body.classList.remove("dark-theme");
            document.body.classList.add("light-theme");
            themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
            localStorage.setItem("theme", "light");
        } else {
            document.body.classList.add("dark-theme");
            document.body.classList.remove("light-theme");
            themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
            localStorage.setItem("theme", "dark");
        }
        // Redraw charts to update text colors
        updateChartsTheme();
    });
}

// --- Tab Switching ---
function setupTabSwitching() {
    const navItems = document.querySelectorAll(".nav-item");
    const tabPanes = document.querySelectorAll(".tab-pane");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");
            
            navItems.forEach(i => i.classList.remove("active"));
            tabPanes.forEach(p => p.classList.remove("active"));
            
            item.classList.add("active");
            document.getElementById(`tab-${targetTab}`).classList.add("active");
            
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
            }
        });
    });
}

// --- Load configuration (LocalStorage version) ---
function fetchConfig() {
    const cachedConfig = localStorage.getItem("dashboard_config") || "{}";
    const config = JSON.parse(cachedConfig);
    const urlInput = document.getElementById("settings-url-input");
    if (urlInput && config.onedrive_url) {
        urlInput.value = config.onedrive_url;
    }

    const saveBtn = document.getElementById("save-url-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            const url = document.getElementById("settings-url-input").value;
            if (!url) {
                showToast("Please enter a valid URL", "error");
                return;
            }
            const newConfig = { onedrive_url: url };
            localStorage.setItem("dashboard_config", JSON.stringify(newConfig));
            showToast("Settings saved successfully", "success");
        });
    }

    const resetCacheBtn = document.getElementById("reset-cache-btn");
    if (resetCacheBtn) {
        resetCacheBtn.addEventListener("click", () => {
            localStorage.removeItem("dashboard_static_data");
            showToast("Cache cleared! Reloading dashboard...", "info");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        });
    }
}

// --- Fetch Dashboard Data ---
function loadDashboardData() {
    const lastSyncEl = document.getElementById("last-sync-time");
    const cachedData = localStorage.getItem("dashboard_static_data");
    
    if (!cachedData) {
        // Show initial load overlay
        const initialOverlay = document.getElementById("initial-load-overlay");
        if (initialOverlay) {
            initialOverlay.classList.remove("hidden");
        }
        lastSyncEl.innerText = "No data loaded";
        return;
    }
    
    // Hide initial load overlay
    const initialOverlay = document.getElementById("initial-load-overlay");
    if (initialOverlay) {
        initialOverlay.classList.add("hidden");
    }

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
        
        showToast("Patient data loaded from local storage", "success");
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
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        if (!isNaN(y) && !isNaN(val.getMonth()) && !isNaN(val.getDate())) {
            return `${y}-${m}-${d}`;
        }
        return val.toISOString().split('T')[0];
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
function processUploadedExcel(file) {
    const overlay = document.getElementById("sync-loading-overlay");
    const stepConnect = document.getElementById("step-connect");
    const stepDownload = document.getElementById("step-download");
    const stepParse = document.getElementById("step-parse");
    
    if (overlay) overlay.classList.remove("hidden");
    if (stepConnect) {
        stepConnect.className = "step active";
        stepConnect.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading local file...';
    }
    if (stepDownload) {
        stepDownload.className = "step";
        stepDownload.innerHTML = '<i class="fa-solid fa-circle"></i> Parsing worksheets using SheetJS';
    }
    if (stepParse) {
        stepParse.className = "step";
        stepParse.innerHTML = '<i class="fa-solid fa-circle"></i> Calculating metrics and drawing dashboard';
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            if (stepConnect) {
                stepConnect.className = "step completed";
                stepConnect.innerHTML = '<i class="fa-solid fa-circle-check"></i> Local file read successfully';
            }
            if (stepDownload) {
                stepDownload.className = "step active";
                stepDownload.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Parsing worksheets using SheetJS...';
            }

            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array', cellDates: true});
            
            // 1. Parse Tracking Sheet
            const trackingSheet = workbook.Sheets["Tracking sheet"];
            if (!trackingSheet) {
                throw new Error("'Tracking sheet' worksheet not found in the uploaded workbook!");
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
            for (let i = 0; i < rows.length; i++) {
                const firstCell = String(rows[i][0] || '').trim();
                if (firstCell.includes("Patient Name") || firstCell.includes("اسم المريض")) {
                    headerIdx = i;
                    break;
                }
            }
            if (headerIdx === -1) {
                headerIdx = Math.min(3, rows.length - 1);
            }
            
            const headers = rows[headerIdx].map((h, i) => String(h || '').trim() || `Column_${i}`);
            const patients = [];
            
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[0] || !String(row[0]).trim()) {
                    continue; // Skip empty patient names
                }
                const pat = {};
                for (let c = 0; c < headers.length; c++) {
                    const h = headers[c];
                    const val = row[c];
                    pat[h] = excelValueToString(val, h);
                }
                patients.push(pat);
            }
            
            // 2. Parse Lists Sheet (Dropdown items)
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

            if (stepDownload) {
                stepDownload.className = "step completed";
                stepDownload.innerHTML = '<i class="fa-solid fa-circle-check"></i> Worksheets parsed successfully';
            }
            if (stepParse) {
                stepParse.className = "step active";
                stepParse.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Calculating metrics and drawing dashboard...';
            }

            setTimeout(() => {
                // Update global data state
                patientsData = patients;
                dropdownLists = parsedLists;
                
                const lastSyncTime = new Date().toLocaleString("en-US", { hour12: true });
                document.getElementById("last-sync-time").innerText = lastSyncTime;
                
                // Cache locally
                const cachedData = {
                    patients: patientsData,
                    lists: dropdownLists,
                    metadata: {
                        last_synced: lastSyncTime,
                        total_records: patientsData.length
                    }
                };
                localStorage.setItem("dashboard_static_data", JSON.stringify(cachedData));

                // Hide overlays
                if (overlay) overlay.classList.add("hidden");
                const initialOverlay = document.getElementById("initial-load-overlay");
                if (initialOverlay) initialOverlay.classList.add("hidden");

                // Initialize dashboard components
                populateFilterOptions();
                calculateKPIs();
                renderCharts();
                applyFilters();
                updateBadges();

                showToast(`Data processed successfully! Loaded ${patientsData.length} records.`, "success");
            }, 800);

        } catch (err) {
            console.error("Excel parse error:", err);
            if (overlay) overlay.classList.add("hidden");
            showToast("Failed to parse Excel file: " + err.message, "error");
        }
    };
    
    reader.onerror = function() {
        if (overlay) overlay.classList.add("hidden");
        showToast("Failed to read the file.", "error");
    };
    
    reader.readAsArrayBuffer(file);
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
        el.innerHTML = '<option value="">All</option>';
        [...items].sort().forEach(item => {
            el.innerHTML += `<option value="${item}">${item}</option>`;
        });
    };

    populateDropdown("filter-clinic", clinics);
    populateDropdown("filter-division", divisions);
    populateDropdown("filter-coordinator", coordinators);
    populateDropdown("filter-status", statuses);
}

// --- Calculate KPIs ---
function calculateKPIs() {
    const total = patientsData.length;
    
    let active = 0;
    let pendingReferrals = 0;
    let ncmCount = 0;
    let activeBarriers = 0;
    
    patientsData.forEach(pat => {
        const status = getPatientVal(pat, 'status').toLowerCase();
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase();
        const barrier = getPatientVal(pat, 'barrier');
        
        if (status === 'active' || status === 'نشط' || status === 'مستمر') active++;
        if (refStatus === 'pending') pendingReferrals++;
        if (ncm === 'yes' || ncm === 'نعم') ncmCount++;
        
        if (barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no') {
            activeBarriers++;
        }
    });

    document.getElementById("kpi-total-patients").innerText = total;
    document.getElementById("kpi-active-patients").innerText = active;
    document.getElementById("kpi-pending-referrals").innerText = pendingReferrals;
    document.getElementById("kpi-ncm-cases").innerText = ncmCount;
    document.getElementById("kpi-active-barriers").innerText = activeBarriers;
    updateMasterFunnel();
}

// --- Update Badges in Sidebar ---
function updateBadges() {
    let pendingReferrals = 0;
    let ncmCount = 0;
    let activeBarriers = 0;
    
    patientsData.forEach(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase();
        const barrier = getPatientVal(pat, 'barrier');
        
        if (refStatus === 'pending') pendingReferrals++;
        if (ncm === 'yes' || ncm === 'نعم') ncmCount++;
        
        if (barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no') {
            activeBarriers++;
        }
    });

    document.getElementById("badge-followup").innerText = pendingReferrals;
    document.getElementById("badge-ncm").innerText = ncmCount;
    document.getElementById("badge-barriers").innerText = activeBarriers;

    // Analytics badge = total issues across all 6 analyses
    const analyticsTotal = computeAnalyticsCounts();
    document.getElementById("badge-analytics").innerText = analyticsTotal.total;
}

// --- Filters & Grid Search ---
function setupFilterListeners() {
    const searchInput = document.getElementById("master-search-input");
    const filterClinic = document.getElementById("filter-clinic");
    const filterDivision = document.getElementById("filter-division");
    const filterCoordinator = document.getElementById("filter-coordinator");
    const filterStatus = document.getElementById("filter-status");
    const clearBtn = document.getElementById("clear-filters-btn");
    
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
        btn.addEventListener("click", () => {
            pillBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentQuickFilter = btn.getAttribute("data-filter") || 'all';
            pagination.currentPage = 1;
            applyFilters();
        });
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            filterClinic.value = "";
            filterDivision.value = "";
            filterCoordinator.value = "";
            filterStatus.value = "";
            
            // Clear tab-specific searches
            document.querySelectorAll(".table-actions input[type='text'], .filter-bar input[type='text']").forEach(inp => inp.value = "");
            
            // Reset quick filter pill
            pillBtns.forEach(b => b.classList.remove("active"));
            const allBtn = document.querySelector(".pill-btn[data-filter='all']");
            if (allBtn) allBtn.classList.add("active");
            currentQuickFilter = 'all';

            pagination.currentPage = 1;
            applyFilters();
            
            // Re-render other tabs to clear their search
            renderFollowupTab();
            renderNcmTab();
            renderInpatientTab();
            renderOutpatientTab();
            renderBarriersTab();
            renderAnalyticsTab();
            
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
            
            // Update sort arrows UI
            thElements.forEach(el => {
                const icon = el.querySelector("i");
                if (icon) icon.className = "fa-solid fa-sort";
            });
            const activeIcon = th.querySelector("i");
            if (activeIcon) {
                activeIcon.className = currentSort.direction === 'asc' ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
            
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
        
        // Quick filter check
        let matchesQuickFilter = true;
        if (currentQuickFilter === 'barriers') {
            matchesQuickFilter = hasActiveBarrier(pat);
        } else if (currentQuickFilter === 'pending-referrals') {
            const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase().trim();
            matchesQuickFilter = (refStatus === 'pending' || refStatus === 'قيد الانتظار' || refStatus === 'معلق');
        } else if (currentQuickFilter === 'ncm-cases') {
            const ncm = getPatientVal(pat, 'ncm').toLowerCase().trim();
            matchesQuickFilter = (ncm === 'yes' || ncm === 'نعم');
        } else if (currentQuickFilter === 'permit-stage') {
            const permitSent = getPatientVal(pat, 'permitSent').toLowerCase().trim();
            matchesQuickFilter = (permitSent === 'yes' || permitSent === 'نعم');
        } else if (currentQuickFilter === 'chemo-missing') {
            const chemo = getPatientVal(pat, 'chemoDate').trim();
            matchesQuickFilter = !chemo || !/^\d{4}-\d{2}-\d{2}$/.test(chemo);
        } else if (currentQuickFilter === 'chemo-scheduled') {
            const chemo = getPatientVal(pat, 'chemoDate').trim();
            matchesQuickFilter = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo);
        }
        
        return matchesSearch && matchesClinic && matchesDivision && matchesCoordinator && matchesStatus && matchesQuickFilter;
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

function renderMainTable() {
    const tbody = document.getElementById("patients-table-body");
    const countEl = document.getElementById("matching-records-count");
    
    countEl.innerText = filteredPatients.length;
    tbody.innerHTML = "";
    
    if (filteredPatients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 30px; color: var(--text-muted);">No matching results found for the current filters.</td></tr>`;
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
            <td>${id}</td>
            <td>${clinic}</td>
            <td>${division || '-'}</td>
            <td>${coordinator}</td>
            <td>${physician}</td>
            <td><span class="status-pill ${getPillClass(treatmentRef)}">${treatmentRef || 'none'}</span></td>
            <td><span class="status-pill ${getPillClass(permit)}">${permit || 'none'}</span></td>
            <td><span class="status-pill ${getPillClass(status)}">${status || 'none'}</span></td>
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
        
        row.addEventListener("click", () => {
            openPatientDrawer(pat);
        });
        
        tbody.appendChild(row);
    });

    updatePaginationUI(total);
}

function getPillClass(val) {
    if (!val) return 'none';
    const s = val.toLowerCase().trim();
    if (s === 'approved' || s === 'active' || s === 'yes' || s === 'completed' || s === 'نعم' || s === 'موافق عليه' || s === 'تم التنسيق') return 'approved';
    if (s === 'pending' || s === 'on hold' || s === 'قيد الانتظار' || s === 'معلق') return 'pending';
    if (s === 'rejected' || s === 'closed' || s === 'no' || s === 'مرفوض' || s === 'لا' || s === 'ملغي') return 'rejected';
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
        const isPending = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase() === 'pending';
        if (!isPending) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">No pending treatment referrals currently.</td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'physician')}</td>
            <td>${getPatientVal(pat, 'treatmentPlan') || '-'}</td>
            <td class="text-danger">${getPatientVal(pat, 'barrier') || '-'}</td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        tbody.appendChild(row);
    });
}

// --- Render New Cases Meeting Tab ---
function renderNcmTab() {
    const tbody = document.getElementById("ncm-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("ncm-search-input") ? document.getElementById("ncm-search-input").value.toLowerCase() : "";
    
    const list = patientsData.filter(pat => {
        const val = getPatientVal(pat, 'ncm').toLowerCase();
        const isNcm = val === 'yes' || val === 'نعم';
        if (!isNcm) return false;
        if (!searchVal) return true;
        
        const name = getPatientVal(pat, 'name').toLowerCase();
        const id = getPatientVal(pat, 'id').toLowerCase();
        const file = getPatientVal(pat, 'file').toLowerCase();
        return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">No cases scheduled for the weekly meeting.</td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'physician')}</td>
            <td>${getPatientVal(pat, 'treatmentPlan') || '-'}</td>
            <td class="text-indigo"><strong>${getPatientVal(pat, 'ncmDecision') || '-'}</strong></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
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
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">No inpatient cases currently registered in the system.</td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getPatientVal(pat, 'chemoDate') || '-'}</td>
            <td class="text-danger">${getPatientVal(pat, 'barrier') || '-'}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
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
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">No outpatient cases currently registered.</td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getPatientVal(pat, 'chemoDate') || '-'}</td>
            <td class="text-danger">${getPatientVal(pat, 'barrier') || '-'}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'status'))}">${getPatientVal(pat, 'status')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
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
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">Great! No active barriers or coordination issues currently.</td></tr>`;
        return;
    }

    list.forEach(pat => {
        const row = document.createElement("tr");
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute("data-patient-id", getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td>${getPatientNameHTML(pat)}</td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td class="text-danger"><strong>${getPatientVal(pat, 'barrier')}</strong></td>
            <td>${getPatientVal(pat, 'notes') || '-'}</td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'treatmentReferralStatus'))}">${getPatientVal(pat, 'treatmentReferralStatus')}</span></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'permitStatus'))}">${getPatientVal(pat, 'permitStatus')}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i> Details</button>
            </td>
        `;
        row.querySelector(".open-details-btn").addEventListener("click", () => openPatientDrawer(pat));
        row.addEventListener("click", () => openPatientDrawer(pat));
        tbody.appendChild(row);
    });
}

// --- Sliding Details Drawer Render ---
function openPatientDrawer(pat) {
    // Fill values
    document.getElementById("drawer-patient-name").innerText = getPatientVal(pat, 'name');
    document.getElementById("drawer-patient-id").innerText = getPatientVal(pat, 'id') || '-';
    document.getElementById("drawer-patient-file").innerText = getPatientVal(pat, 'file') || '-';
    
    // Redesigned Top Status Summary Board
    const csBadge = document.getElementById("drawer-case-status-badge");
    const trBadge = document.getElementById("drawer-referral-status-badge");
    const psBadge = document.getElementById("drawer-permit-status-badge");
    const chBadge = document.getElementById("drawer-chemo-date-badge");
    
    const caseSt = getPatientVal(pat, 'status') || 'none';
    const trSt = getPatientVal(pat, 'treatmentReferralStatus') || 'none';
    const pmSt = getPatientVal(pat, 'permitStatus') || 'none';
    const chDt = getPatientVal(pat, 'chemoDate') || '-';
    
    csBadge.innerText = caseSt;
    csBadge.className = `sb-val status-pill ${getPillClass(caseSt)}`;
    
    trBadge.innerText = trSt;
    trBadge.className = `sb-val status-pill ${getPillClass(trSt)}`;
    
    psBadge.innerText = pmSt;
    psBadge.className = `sb-val status-pill ${getPillClass(pmSt)}`;
    
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
    if (barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no') {
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
                <strong>${note.title}</strong>
                <p>${note.description}</p>
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
    
    const ctxClinic = document.getElementById('chart-clinic-division').getContext('2d');
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
    
    const ctxRef = document.getElementById('chart-referral-status').getContext('2d');
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

    const ctxDiag = document.getElementById('chart-diagnoses').getContext('2d');
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
    
    const ctxCoord = document.getElementById('chart-coordinators').getContext('2d');
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
        const ref = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase();
        return ref === 'pending' && (ncm === 'no' || ncm === '' || ncm === '0');
    });
    const a2 = patientsData.filter(pat => {
        const ref = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase();
        return ref === 'pending' && ncm === 'yes';
    });
    const a3 = patientsData.filter(pat => {
        const sent = getPatientVal(pat, 'permitSent').toLowerCase();
        const status = getPatientVal(pat, 'permitStatus').toLowerCase();
        return sent === 'yes' && (status === 'pending' || status === '' || status === '0');
    });
    const a4 = patientsData.filter(pat => {
        const forms = getPatientVal(pat, 'referralForms').toLowerCase();
        const otherRef = getPatientVal(pat, 'otherReferralStatus').toLowerCase();
        return forms && forms !== 'no' && forms !== '0' && otherRef === 'pending';
    });
    const a5 = patientsData.filter(pat => {
        const refType = getPatientVal(pat, 'referralType').toLowerCase();
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase();
        return (refType.includes('without') || refType.includes('evaluation') || refType.includes('follow up') || refType.includes('follow-up'))
            && refStatus === 'pending';
    });
    const a6 = patientsData.filter(pat => {
        const ncm = getPatientVal(pat, 'ncm').toLowerCase();
        const chemo = getPatientVal(pat, 'chemoDate');
        // A valid date looks like YYYY-MM-DD (10 chars, contains dashes)
        const isValidDate = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo.trim());
        return (ncm === 'yes' || ncm === 'نعم') && !isValidDate;
    });
    const a7 = patientsData.filter(pat => {
        const chemo = getPatientVal(pat, 'chemoDate');
        const isValidDate = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo.trim());
        const notified = getPatientVal(pat, 'notified').toLowerCase().trim();
        return isValidDate && (notified === 'no' || notified === '' || notified === '0');
    });
    const a8 = patientsData.filter(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase().trim();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase().trim();
        const refType = getPatientVal(pat, 'referralType').toLowerCase().trim();
        const chemo = getPatientVal(pat, 'chemoDate');
        const isValidDate = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo.trim());
        return (refStatus === 'approved' || refStatus === 'موافق عليه') &&
               (ncm === 'no' || ncm === '' || ncm === '0' || ncm === 'لا') &&
               (refType === 'treatment' || refType === 'علاج') &&
               !isValidDate;
    });
    const a9 = patientsData.filter(pat => {
        const refStatus = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase().trim();
        const ncm = getPatientVal(pat, 'ncm').toLowerCase().trim();
        const refType = getPatientVal(pat, 'referralType').toLowerCase().trim();
        const chemo = getPatientVal(pat, 'chemoDate');
        const isValidDate = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo.trim());
        return (refStatus === 'approved' || refStatus === 'موافق عليه') &&
               (ncm === 'yes' || ncm === 'نعم') &&
               (refType === 'treatment' || refType === 'علاج') &&
               !isValidDate;
    });
    return { a1, a2, a3, a4, a5, a6, a7, a8, a9, total: a1.length + a2.length + a3.length + a4.length + a5.length + a6.length + a7.length + a8.length + a9.length };
}

// --- Render Analytics Tab ---
function renderAnalyticsTab() {
    const counts = computeAnalyticsCounts();
    
    const searchVal = document.getElementById("analytics-search-input") ? document.getElementById("analytics-search-input").value.toLowerCase() : "";
    const filterBySearch = (list) => {
        if (!searchVal) return list;
        return list.filter(pat => {
            const name = getPatientVal(pat, 'name').toLowerCase();
            const id = getPatientVal(pat, 'id').toLowerCase();
            const file = getPatientVal(pat, 'file').toLowerCase();
            return name.includes(searchVal) || id.includes(searchVal) || file.includes(searchVal);
        });
    };
    
    const a1 = filterBySearch(counts.a1);
    const a2 = filterBySearch(counts.a2);
    const a3 = filterBySearch(counts.a3);
    const a4 = filterBySearch(counts.a4);
    const a5 = filterBySearch(counts.a5);
    const a6 = filterBySearch(counts.a6);
    const a7 = filterBySearch(counts.a7);
    const a8 = filterBySearch(counts.a8);
    const a9 = filterBySearch(counts.a9);

    // Update summary KPI mini-cards
    document.getElementById('akpi-val-1').innerText = a1.length;
    document.getElementById('akpi-val-2').innerText = a2.length;
    document.getElementById('akpi-val-3').innerText = a3.length;
    document.getElementById('akpi-val-4').innerText = a4.length;
    document.getElementById('akpi-val-5').innerText = a5.length;
    document.getElementById('akpi-val-6').innerText = a6.length;
    document.getElementById('akpi-val-7').innerText = a7.length;
    document.getElementById('akpi-val-8').innerText = a8.length;
    document.getElementById('akpi-val-9').innerText = a9.length;

    // Update count badges on section headers
    document.getElementById('count-a1').innerText = a1.length;
    document.getElementById('count-a2').innerText = a2.length;
    document.getElementById('count-a3').innerText = a3.length;
    document.getElementById('count-a4').innerText = a4.length;
    document.getElementById('count-a5').innerText = a5.length;
    document.getElementById('count-a6').innerText = a6.length;
    document.getElementById('count-a7').innerText = a7.length;
    document.getElementById('count-a8').innerText = a8.length;
    document.getElementById('count-a9').innerText = a9.length;

    const emptyRow = (cols) => `<tr><td colspan="${cols}" style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fa-solid fa-circle-check" style="color:var(--color-success);margin-right:6px;"></i> No cases match this filter</td></tr>`;

    // --- Analysis 1: Pending + NCM = No/Empty ---
    const tbody1 = document.getElementById('analytics-tbody-1');
    tbody1.innerHTML = a1.length === 0 ? emptyRow(9) : '';
    a1.forEach(pat => {
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'treatmentPlan') || '-'}</td>
            <td><span class="status-pill rejected">${getPatientVal(pat, 'ncm') || 'Empty'}</span></td>
            <td class="text-danger">${getPatientVal(pat, 'barrier') || '-'}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody1.appendChild(row);
    });

    // --- Analysis 2: Pending + NCM = Yes ---
    const tbody2 = document.getElementById('analytics-tbody-2');
    tbody2.innerHTML = a2.length === 0 ? emptyRow(9) : '';
    a2.forEach(pat => {
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'physician')}</td>
            <td>${getPatientVal(pat, 'treatmentPlan') || '-'}</td>
            <td class="text-indigo"><strong>${getPatientVal(pat, 'ncmDecision') || 'No Decision'}</strong></td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody2.appendChild(row);
    });

    // --- Analysis 3: Permit form sent + Permit Status pending/empty ---
    const tbody3 = document.getElementById('analytics-tbody-3');
    tbody3.innerHTML = a3.length === 0 ? emptyRow(8) : '';
    a3.forEach(pat => {
        const permitStatus = getPatientVal(pat, 'permitStatus') || 'Empty';
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td><span class="status-pill approved">${getPatientVal(pat, 'permitSent')}</span></td>
            <td><span class="status-pill pending">${permitStatus}</span></td>
            <td>${getPatientVal(pat, 'notified') || '-'}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody3.appendChild(row);
    });

    // --- Analysis 4: Referral forms sent + Other Referral Status = pending ---
    const tbody4 = document.getElementById('analytics-tbody-4');
    tbody4.innerHTML = a4.length === 0 ? emptyRow(8) : '';
    a4.forEach(pat => {
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'referralForms')}</td>
            <td><span class="status-pill pending">${getPatientVal(pat, 'otherReferralStatus')}</span></td>
            <td><span class="status-pill ${getPillClass(getPatientVal(pat, 'treatmentReferralStatus'))}">${getPatientVal(pat, 'treatmentReferralStatus') || '-'}</span></td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody4.appendChild(row);
    });

    // --- Analysis 5: Referral type without/evaluation + Treatment Referral = pending ---
    const tbody5 = document.getElementById('analytics-tbody-5');
    tbody5.innerHTML = a5.length === 0 ? emptyRow(8) : '';
    a5.forEach(pat => {
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td style="color:var(--color-warning);font-weight:600;">${getPatientVal(pat, 'referralType')}</td>
            <td><span class="status-pill pending">${getPatientVal(pat, 'treatmentReferralStatus')}</span></td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody5.appendChild(row);
    });

    // --- Analysis 6: NCM = Yes + Chemo Date not a valid date ---
    const tbody6 = document.getElementById('analytics-tbody-6');
    tbody6.innerHTML = a6.length === 0 ? emptyRow(8) : '';
    a6.forEach(pat => {
        const chemoRaw = getPatientVal(pat, 'chemoDate');
        const chemoDisplay = chemoRaw && chemoRaw !== '0' && chemoRaw !== '' ? chemoRaw : 'Empty';
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td>${getPatientVal(pat, 'ncmDecision') || '-'}</td>
            <td style="color:var(--color-warning);font-weight:600;">${chemoDisplay}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody6.appendChild(row);
    });

    // --- Analysis 7: Scheduled Chemo — Notification Pending ---
    const tbody7 = document.getElementById('analytics-tbody-7');
    tbody7.innerHTML = a7.length === 0 ? emptyRow(8) : '';
    a7.forEach(pat => {
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${getPatientVal(pat, 'diagnosis')}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td class="text-green">${getPatientVal(pat, 'chemoDate')}</td>
            <td><span class="status-pill rejected">${getPatientVal(pat, 'notified') || 'Empty'}</span></td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody7.appendChild(row);
    });

    // --- Analysis 8: Approved Referral (NCM = No) — Missing Chemo Appointment ---
    const tbody8 = document.getElementById('analytics-tbody-8');
    tbody8.innerHTML = a8.length === 0 ? emptyRow(7) : '';
    a8.forEach(pat => {
        const div = getPatientVal(pat, 'division');
        const divLower = div.toLowerCase();
        let actionMsg = "No chemotherapy appointment booked (Check Division)";
        if (divLower.includes('outpatient')) {
            actionMsg = "No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department";
        } else if (divLower.includes('inpatient')) {
            actionMsg = "Book an appointment with the inpatient coordinator";
        }
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${div || '-'}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td class="text-danger font-weight-bold">${actionMsg}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody8.appendChild(row);
    });

    // --- Analysis 9: Approved Referral (NCM = Yes) — Missing Chemo Appointment ---
    const tbody9 = document.getElementById('analytics-tbody-9');
    tbody9.innerHTML = a9.length === 0 ? emptyRow(7) : '';
    a9.forEach(pat => {
        const div = getPatientVal(pat, 'division');
        const divLower = div.toLowerCase();
        let actionMsg = "No chemotherapy appointment booked (Check Division)";
        if (divLower.includes('outpatient')) {
            actionMsg = "No chemotherapy appointment has been booked yet by the oncology pharmacy/chemotherapy department";
        } else if (divLower.includes('inpatient')) {
            actionMsg = "Book an appointment with the inpatient coordinator";
        }
        const row = document.createElement('tr');
        if (hasActiveBarrier(pat)) row.classList.add("has-barrier");
        row.setAttribute('data-patient-id', getPatientVal(pat, 'id'));
        row.innerHTML = `
            <td><strong>${getPatientVal(pat, 'name')}</strong></td>
            <td>${getPatientVal(pat, 'id')}</td>
            <td>${getPatientVal(pat, 'clinic')}</td>
            <td>${div || '-'}</td>
            <td>${getPatientVal(pat, 'coordinator')}</td>
            <td class="text-danger font-weight-bold">${actionMsg}</td>
            <td><button class="btn btn-secondary btn-sm open-details-btn"><i class="fa-solid fa-eye"></i></button></td>
        `;
        row.querySelector('.open-details-btn').addEventListener('click', () => openPatientDrawer(pat));
        row.addEventListener('click', () => openPatientDrawer(pat));
        tbody9.appendChild(row);
    });
}

// --- Smart Notes Generation logic ---
function getSmartNotes(pat) {
    const notes = [];
    
    const ref = getPatientVal(pat, 'treatmentReferralStatus').toLowerCase().trim();
    const ncm = getPatientVal(pat, 'ncm').toLowerCase().trim();
    const sent = getPatientVal(pat, 'permitSent').toLowerCase().trim();
    const permitStatus = getPatientVal(pat, 'permitStatus').toLowerCase().trim();
    const forms = getPatientVal(pat, 'referralForms').toLowerCase().trim();
    const otherRef = getPatientVal(pat, 'otherReferralStatus').toLowerCase().trim();
    const refType = getPatientVal(pat, 'referralType').toLowerCase().trim();
    const chemo = getPatientVal(pat, 'chemoDate');
    const barrier = getPatientVal(pat, 'barrier');
    
    // Rule 1: Pending + NCM = No/Empty
    if (ref === 'pending' && (ncm === 'no' || ncm === '' || ncm === '0')) {
        notes.push({
            title: "NCM Required",
            description: "Treatment referral status is Pending but the case has not been presented in the New Cases Meeting (NCM = No/Empty). Please present the file in the next meeting.",
            level: "danger",
            chipText: "NCM Required",
            icon: "fa-solid fa-triangle-exclamation"
        });
    }
    
    // Rule 2: Pending + NCM = Yes
    if (ref === 'pending' && ncm === 'yes') {
        notes.push({
            title: "Awaiting NCM Decision",
            description: "Case has been presented in the New Cases Meeting (NCM = Yes) but treatment referral status remains Pending, awaiting final decision approval.",
            level: "info",
            chipText: "Awaiting NCM",
            icon: "fa-solid fa-clock-rotate-left"
        });
    }
    
    // Rule 3: Permit Form Sent = Yes + Permit Status = Pending/Empty
    if (sent === 'yes' && (permitStatus === 'pending' || permitStatus === '' || permitStatus === '0')) {
        notes.push({
            title: "Follow up Permit Request",
            description: "Permit application form was sent (Permit Sent = Yes) but status remains Pending/Empty. Please follow up for clearance.",
            level: "warning",
            chipText: "Permit Pending",
            icon: "fa-solid fa-id-card-clip"
        });
    }
    
    // Rule 4: Referral Forms Sent ≠ No + Other Referral Status = Pending
    if (forms && forms !== 'no' && forms !== '0' && otherRef === 'pending') {
        notes.push({
            title: "Follow up Other Referral",
            description: "Referral forms were sent but other referral status remains Pending.",
            level: "warning",
            chipText: "Other Referral Pending",
            icon: "fa-solid fa-file-invoice"
        });
    }
    
    // Rule 5: Type = Without/Evaluation + Treatment Referral Status = Pending
    if ((refType.includes('without') || refType.includes('evaluation') || refType.includes('follow up') || refType.includes('follow-up')) && ref === 'pending') {
        notes.push({
            title: "Review Pending Referral Type",
            description: "Referral type is (Without / Follow-up / Evaluation) but treatment referral status is Pending. Please review medical file.",
            level: "warning",
            chipText: "Referral Type Pending",
            icon: "fa-solid fa-clipboard-question"
        });
    }
    
    // Rule 6: NCM = Yes + Chemo Date invalid/empty
    const isValidDate = chemo && /^\d{4}-\d{2}-\d{2}$/.test(chemo.trim());
    if ((ncm === 'yes' || ncm === 'نعم') && !isValidDate) {
        notes.push({
            title: "Chemo Session Date Missing",
            description: "Case approved in the New Cases Meeting (NCM = Yes) but first chemotherapy session date is not scheduled yet.",
            level: "danger",
            chipText: "Schedule Chemo Date",
            icon: "fa-solid fa-calendar-xmark"
        });
    }

    // Rule 7: Scheduled Chemo — Notification Pending
    const notified = getPatientVal(pat, 'notified').toLowerCase().trim();
    if (isValidDate && (notified === 'no' || notified === '' || notified === '0')) {
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
    if ((ref === 'approved' || ref === 'موافق عليه') && (ncm === 'no' || ncm === '' || ncm === '0' || ncm === 'لا') && (refType === 'treatment' || refType === 'علاج') && !isValidDate) {
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
    if ((ref === 'approved' || ref === 'موافق عليه') && (ncm === 'yes' || ncm === 'نعم') && (refType === 'treatment' || refType === 'علاج') && !isValidDate) {
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
    if (barrier && barrier !== '0' && barrier !== '0.0' && barrier.toLowerCase() !== 'none' && barrier.toLowerCase() !== 'no') {
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
        return `<span class="smart-note-chip sn-${note.level}" data-tooltip="${note.description}"><i class="${note.icon}"></i> ${note.chipText}</span>`;
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
            let val = getPatientVal(pat, col.key) || '-';
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
            metaEl.innerHTML = `<span>File: ${file}</span> <span>ID: ${id}</span>`;
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
                    chip.innerHTML = `<i class="${note.icon}"></i> ${note.chipText || note.title}`;
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
                        <span class="smart-note-chip sn-${note.level}" data-tooltip="${note.description}">
                            <i class="${note.icon}"></i> ${note.chipText || note.title}
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
                } else if (key === 'chemoDate' && val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                    highlightClass = "highlight-success";
                } else if (key === 'treatmentReferralStatus' && val.toLowerCase() === 'pending') {
                    highlightClass = "highlight-danger";
                }
                
                fullDataGridHtml += `
                <div class="data-field ${highlightClass}">
                    <span class="data-label">${label}</span>
                    <span class="data-value">${val || '-'}</span>
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
                        <i class="fa-solid fa-calendar-day"></i> Visit Date / تاريخ الزيارة: ${visitDate || 'N/A'}
                    </div>
                </div>
                <div class="case-card-body">
                    <div class="case-field">
                        <span class="label">Clinic / العيادة</span>
                        <span class="value">${clinic || '-'}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Division / القسم</span>
                        <span class="value">${division || '-'}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Treating Physician / الطبيب المعالج</span>
                        <span class="value">${physician || '-'}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Coordinator / المنسق</span>
                        <span class="value">${coordinator || '-'}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Referral Status / حالة إحالة العلاج</span>
                        <span class="value"><span class="status-pill ${getPillClass(referralStatus)}">${referralStatus || '-'}</span></span>
                    </div>
                    <div class="case-field">
                        <span class="label">Permit Status / حالة التصريح</span>
                        <span class="value"><span class="status-pill ${getPillClass(permitStatus)}">${permitStatus || '-'}</span></span>
                    </div>
                    <div class="case-field">
                        <span class="label">Chemo Date / تاريخ الكيماوي</span>
                        <span class="value ${chemoDate ? 'text-green font-weight-bold' : ''}">${chemoDate || '-'}</span>
                    </div>
                    <div class="case-field">
                        <span class="label">Case Status / حالة الملف</span>
                        <span class="value"><span class="status-pill ${getPillClass(caseStatus)}">${caseStatus || '-'}</span></span>
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
                        <h2>${group.name}</h2>
                        <div class="patient-profile-badges">
                            ${group.id ? `<span class="profile-badge id-badge"><i class="fa-solid fa-id-card"></i> ID: ${group.id}</span>` : ''}
                            ${group.file ? `<span class="profile-badge file-badge"><i class="fa-solid fa-folder-open"></i> File: ${group.file}</span>` : ''}
                        </div>
                    </div>
                    <div class="patient-profile-status-row">
                        <div class="status-summary-item">
                            <span class="label">Total Referral Records / إجمالي سجلات الإحالة:</span>
                            <span class="count-badge">${group.records.length}</span>
                        </div>
                        <div class="status-summary-item">
                            <span class="label">Current Status / الحالة الحالية:</span>
                            <span class="status-pill ${getPillClass(currentCaseStatus)}">${currentCaseStatus || 'Unknown'}</span>
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


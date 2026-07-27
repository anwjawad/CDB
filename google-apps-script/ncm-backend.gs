/**
 * NCM Collaborative Workspace — Backend (Phase A)
 *
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * See ../google-apps-script/README.md for full setup instructions.
 *
 * Data lives in this Spreadsheet's "NCM" and "NCM_Audit" tabs.
 * All column access is by header name (getColumnMap_), never by
 * hardcoded column letter/number, so the sheet layout can evolve
 * without breaking this script.
 */

var NCM_SHEET_NAME = "NCM";
var AUDIT_SHEET_NAME = "NCM_Audit";

var NCM_HEADERS = [
  "patientKey", "source", "masterLinked", "patientName", "patientFile", "patientId",
  "clinic", "division", "diagnosis", "primaryPhysician",
  "referralType", "referralForms", "treatmentReferralStatus", "otherReferralStatus",
  "permitSent", "permitStatus",
  "clinicVisitDate", "chemoDate", "otherAppointments",
  "patientNotified", "patientNotifiedOther",
  "barrier", "caseStatus",
  "sharedTreatmentPlan", "sharedNotes",
  "coordinatorBriefHistory", "coordinatorTreatmentPlan", "coordinatorNotes",
  "coordinatorMeetingNotes", "coordinatorDecision", "coordinatorStatus",
  "coordinatorVersion", "coordinatorUpdatedAt", "coordinatorUpdatedBy",
  "residentBriefHistory", "residentAssessment", "residentTreatmentPlan", "residentNotes",
  "residentMeetingNotes", "residentDecision", "residentStatus",
  "residentVersion", "residentUpdatedAt", "residentUpdatedBy",
  "createdAt", "createdBy", "updatedAt"
];

var AUDIT_HEADERS = ["timestamp", "patientKey", "user", "role", "action", "changedFields"];

var SHARED_FIELDS = ["sharedTreatmentPlan", "sharedNotes", "caseStatus", "barrier"];
var COORDINATOR_FIELDS = [
  "coordinatorBriefHistory", "coordinatorTreatmentPlan", "coordinatorNotes",
  "coordinatorMeetingNotes", "coordinatorDecision", "coordinatorStatus"
];
var RESIDENT_FIELDS = [
  "residentBriefHistory", "residentAssessment", "residentTreatmentPlan", "residentNotes",
  "residentMeetingNotes", "residentDecision", "residentStatus"
];

// --- Entry points ---------------------------------------------------------

function doGet(e) {
  return handleRequest_(e, "GET");
}

function doPost(e) {
  return handleRequest_(e, "POST");
}

function handleRequest_(e, method) {
  try {
    var params = method === "GET" ? (e.parameter || {}) : parseBody_(e);
    var action = params.action;

    if (!checkToken_(params)) {
      return jsonResponse_({ success: false, error: "Invalid or missing token." });
    }

    var readActions = { list: 1, get: 1, changes: 1 };
    if (method === "GET" && !readActions[action]) {
      return jsonResponse_({ success: false, error: "Unknown GET action: " + action });
    }
    if (method === "POST" && readActions[action]) {
      return jsonResponse_({ success: false, error: "Action '" + action + "' must be called via GET." });
    }

    switch (action) {
      case "list": return jsonResponse_(actionList_());
      case "get": return jsonResponse_(actionGet_(params));
      case "changes": return jsonResponse_(actionChanges_(params));
      case "import": return jsonResponse_(withLock_(function () { return actionImport_(params); }));
      case "createManual": return jsonResponse_(withLock_(function () { return actionCreateManual_(params); }));
      case "link": return jsonResponse_(withLock_(function () { return actionLink_(params); }));
      case "delete": return jsonResponse_(withLock_(function () { return actionDelete_(params); }));
      case "updateShared": return jsonResponse_(withLock_(function () { return actionUpdateFields_(params, SHARED_FIELDS, null); }));
      case "updateCoordinator": return jsonResponse_(withLock_(function () { return actionUpdateRole_(params, "coordinator", COORDINATOR_FIELDS); }));
      case "updateResident": return jsonResponse_(withLock_(function () { return actionUpdateRole_(params, "resident", RESIDENT_FIELDS); }));
      default: return jsonResponse_({ success: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

function parseBody_(e) {
  if (!e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error("Malformed JSON body.");
  }
}

function checkToken_(params) {
  var expected = PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN");
  if (!expected) return true; // no token configured yet — open during initial setup/testing
  return params.token === expected;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    return { success: false, error: "Could not acquire lock, please retry." };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// --- Sheet helpers ---------------------------------------------------------

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function getNcmSheet_() {
  return getOrCreateSheet_(NCM_SHEET_NAME, NCM_HEADERS);
}

function getAuditSheet_() {
  return getOrCreateSheet_(AUDIT_SHEET_NAME, AUDIT_HEADERS);
}

/** header name -> 1-based column index, read fresh from row 1 every call */
function getColumnMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = String(headerRow[i] || "").trim();
    if (name) map[name] = i + 1;
  }
  return map;
}

function rowToObject_(sheet, colMap, rowValues) {
  var obj = {};
  for (var key in colMap) {
    obj[key] = rowValues[colMap[key] - 1];
  }
  return obj;
}

function findRowIndexByPatientKey_(sheet, colMap, patientKey) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var keyCol = colMap["patientKey"];
  var keys = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(patientKey)) return i + 2; // sheet row number
  }
  return -1;
}

function getAllRowObjects_(sheet, colMap) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function (row) { return rowToObject_(sheet, colMap, row); });
}

function writeRowObject_(sheet, colMap, rowIndex, obj) {
  for (var key in obj) {
    if (colMap[key]) {
      sheet.getRange(rowIndex, colMap[key]).setValue(obj[key]);
    }
  }
}

function appendRowObject_(sheet, colMap, obj) {
  var lastCol = sheet.getLastColumn();
  var row = new Array(lastCol).fill("");
  for (var key in colMap) {
    if (obj.hasOwnProperty(key)) row[colMap[key] - 1] = obj[key];
  }
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function appendAudit_(patientKey, user, role, action, changedFields) {
  var sheet = getAuditSheet_();
  sheet.appendRow([new Date().toISOString(), patientKey, user || "", role || "", action, (changedFields || []).join(", ")]);
}

// --- Identity ---------------------------------------------------------

function normalizeKey_(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildMasterPatientKey_(patientId, patientFile, patientName) {
  var id = normalizeKey_(patientId);
  var file = normalizeKey_(patientFile);
  if (id || file) return "master:" + id + "|" + file;
  return "master-name:" + normalizeKey_(patientName);
}

// --- Actions ---------------------------------------------------------

function actionList_() {
  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  return { success: true, data: getAllRowObjects_(sheet, colMap) };
}

function actionGet_(params) {
  if (!params.patientKey) return { success: false, error: "patientKey is required." };
  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowIndexByPatientKey_(sheet, colMap, params.patientKey);
  if (rowIndex === -1) return { success: false, error: "Patient not found." };
  var lastCol = sheet.getLastColumn();
  var rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { success: true, data: rowToObject_(sheet, colMap, rowValues) };
}

function actionChanges_(params) {
  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var since = params.since ? new Date(params.since).getTime() : 0;
  var all = getAllRowObjects_(sheet, colMap);
  var changed = all.filter(function (row) {
    var t = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
    return t > since;
  });
  return { success: true, data: changed, serverTime: new Date().toISOString() };
}

function actionImport_(params) {
  var patient = params.patient || {};
  if (!patient.patientId && !patient.patientFile && !patient.patientName) {
    return { success: false, error: "At least one of patientId, patientFile, patientName is required." };
  }
  var patientKey = buildMasterPatientKey_(patient.patientId, patient.patientFile, patient.patientName);

  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var existingRowIndex = findRowIndexByPatientKey_(sheet, colMap, patientKey);
  if (existingRowIndex !== -1) {
    var lastCol = sheet.getLastColumn();
    var rowValues = sheet.getRange(existingRowIndex, 1, 1, lastCol).getValues()[0];
    return { success: true, existed: true, data: rowToObject_(sheet, colMap, rowValues) };
  }

  var now = new Date().toISOString();
  var newRow = {
    patientKey: patientKey,
    source: "master",
    masterLinked: true,
    patientName: patient.patientName || "",
    patientFile: patient.patientFile || "",
    patientId: patient.patientId || "",
    clinic: patient.clinic || "",
    division: patient.division || "",
    diagnosis: patient.diagnosis || "",
    primaryPhysician: patient.primaryPhysician || "",
    referralType: patient.referralType || "",
    referralForms: patient.referralForms || "",
    treatmentReferralStatus: patient.treatmentReferralStatus || "",
    otherReferralStatus: patient.otherReferralStatus || "",
    permitSent: patient.permitSent || "",
    permitStatus: patient.permitStatus || "",
    clinicVisitDate: patient.clinicVisitDate || "",
    chemoDate: patient.chemoDate || "",
    otherAppointments: patient.otherAppointments || "",
    patientNotified: patient.patientNotified || "",
    patientNotifiedOther: patient.patientNotifiedOther || "",
    barrier: patient.barrier || "",
    caseStatus: patient.caseStatus || "",
    sharedTreatmentPlan: patient.sharedTreatmentPlan || "",
    sharedNotes: patient.sharedNotes || "",
    coordinatorBriefHistory: patient.coordinatorBriefHistory || "",
    residentBriefHistory: patient.residentBriefHistory || "",
    coordinatorVersion: 0,
    residentVersion: 0,
    createdAt: now,
    createdBy: params.user || "",
    updatedAt: now
  };
  appendRowObject_(sheet, colMap, newRow);
  appendAudit_(patientKey, params.user, params.role, "import", Object.keys(newRow));
  return { success: true, existed: false, data: newRow };
}

function actionCreateManual_(params) {
  var patient = params.patient || {};
  if (!patient.patientName) return { success: false, error: "patientName is required." };

  // Prefer the client-generated key (created at local-save time, before any network round trip)
  // so the local record and the server row stay the same entity. Only generate a fresh one if the
  // client didn't supply one (e.g. a direct API call).
  var patientKey = params.patientKey || ("manual-" + Utilities.getUuid());
  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);

  // Idempotency: if this exact key already exists (e.g. the outbox retried after a dropped
  // response, even though the first attempt actually succeeded), return the existing row instead
  // of appending a duplicate.
  var existingRowIndex = findRowIndexByPatientKey_(sheet, colMap, patientKey);
  if (existingRowIndex !== -1) {
    var existingLastCol = sheet.getLastColumn();
    var existingRowValues = sheet.getRange(existingRowIndex, 1, 1, existingLastCol).getValues()[0];
    return { success: true, existed: true, data: rowToObject_(sheet, colMap, existingRowValues) };
  }

  var now = new Date().toISOString();
  var newRow = {
    patientKey: patientKey,
    source: "manual",
    masterLinked: false,
    patientName: patient.patientName || "",
    patientFile: patient.patientFile || "",
    patientId: patient.patientId || "",
    primaryPhysician: patient.primaryPhysician || "",
    sharedTreatmentPlan: patient.treatmentPlan || "",
    sharedNotes: patient.notes || "",
    coordinatorBriefHistory: patient.briefHistory || "",
    coordinatorVersion: 0,
    residentVersion: 0,
    createdAt: now,
    createdBy: params.user || "",
    updatedAt: now
  };
  appendRowObject_(sheet, colMap, newRow);
  appendAudit_(patientKey, params.user, params.role, "createManual", Object.keys(newRow));
  return { success: true, data: newRow };
}

function actionLink_(params) {
  if (!params.patientKey) return { success: false, error: "patientKey is required." };
  var patient = params.patient || {};

  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowIndexByPatientKey_(sheet, colMap, params.patientKey);
  if (rowIndex === -1) return { success: false, error: "Patient not found." };

  var updates = {
    masterLinked: true,
    patientId: patient.patientId || "",
    patientFile: patient.patientFile || "",
    updatedAt: new Date().toISOString()
  };
  writeRowObject_(sheet, colMap, rowIndex, updates);
  appendAudit_(params.patientKey, params.user, params.role, "link", Object.keys(updates));

  var lastCol = sheet.getLastColumn();
  var rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { success: true, data: rowToObject_(sheet, colMap, rowValues) };
}

function actionDelete_(params) {
  if (!params.patientKey) return { success: false, error: "patientKey is required." };
  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowIndexByPatientKey_(sheet, colMap, params.patientKey);
  if (rowIndex === -1) {
    // Idempotent: already gone counts as success (e.g. a retried outbox entry after a dropped response).
    return { success: true, patientKey: params.patientKey, alreadyDeleted: true };
  }
  sheet.deleteRow(rowIndex);
  appendAudit_(params.patientKey, params.user, params.role, "delete", []);
  return { success: true, patientKey: params.patientKey };
}

function actionUpdateFields_(params, allowedFields, roleForAudit) {
  if (!params.patientKey) return { success: false, error: "patientKey is required." };
  var fields = params.fields || {};

  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowIndexByPatientKey_(sheet, colMap, params.patientKey);
  if (rowIndex === -1) return { success: false, error: "Patient not found." };

  var updates = {};
  var changed = [];
  allowedFields.forEach(function (key) {
    if (fields.hasOwnProperty(key)) {
      updates[key] = fields[key];
      changed.push(key);
    }
  });
  updates.updatedAt = new Date().toISOString();

  writeRowObject_(sheet, colMap, rowIndex, updates);
  appendAudit_(params.patientKey, params.user, roleForAudit, "updateShared", changed);

  var lastCol = sheet.getLastColumn();
  var rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { success: true, data: rowToObject_(sheet, colMap, rowValues) };
}

function actionUpdateRole_(params, role, allowedFields) {
  if (!params.patientKey) return { success: false, error: "patientKey is required." };
  var fields = params.fields || {};
  var versionField = role + "Version";
  var updatedAtField = role + "UpdatedAt";
  var updatedByField = role + "UpdatedBy";

  var sheet = getNcmSheet_();
  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowIndexByPatientKey_(sheet, colMap, params.patientKey);
  if (rowIndex === -1) return { success: false, error: "Patient not found." };

  var lastCol = sheet.getLastColumn();
  var rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var current = rowToObject_(sheet, colMap, rowValues);
  var currentVersion = Number(current[versionField] || 0);
  var expectedVersion = Number(params.expectedVersion);

  if (params.expectedVersion !== undefined && params.expectedVersion !== null && expectedVersion !== currentVersion) {
    return { success: false, conflict: true, server: current };
  }

  var updates = {};
  var changed = [];
  allowedFields.forEach(function (key) {
    if (fields.hasOwnProperty(key)) {
      updates[key] = fields[key];
      changed.push(key);
    }
  });
  var now = new Date().toISOString();
  updates[versionField] = currentVersion + 1;
  updates[updatedAtField] = now;
  updates[updatedByField] = params.user || "";
  updates.updatedAt = now;

  writeRowObject_(sheet, colMap, rowIndex, updates);
  appendAudit_(params.patientKey, params.user, role, "update" + role.charAt(0).toUpperCase() + role.slice(1), changed);

  var updatedRowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return { success: true, data: rowToObject_(sheet, colMap, updatedRowValues) };
}

// --- Response ---------------------------------------------------------

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

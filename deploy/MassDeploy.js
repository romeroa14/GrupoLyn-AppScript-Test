var PROSPR_LIBRARY = {
  userSymbol: 'ProsprScript',
  libraryId: '1KeQgiXH8pWkKLoAvfNvVFsUwhP8QFcidSZt-kNlQWhn9h-lCTJsntd-l',
  version: '39'
};
var MASTER_SCRIPT_ID = '1zoymvQblIfvs0OpfS19s0ZZg9iQZWfRuE5zmI3Z-KrXETq5v5DzZaTkt';
var ADMIN_FILE_NAME = 'GrupoLynAdmin';
var URL_SHEET_NAME = 'Client URLs';
var SEEDED_CLIENT_URLS = ["https://docs.google.com/spreadsheets/d/1PlkJJedBjg8sJ2KdnC_ExpSP5L05kau-cNXEHr85mqU/edit","https://docs.google.com/spreadsheets/d/1eMww-F741r4IDR9KsWrJQj0B_KrrcUDFGSgaR9HJ5UA/edit","https://docs.google.com/spreadsheets/d/15OWz903rm65bs8w3qmuosy3MpEKwMCo3ZHVEkMpqNZc/edit"];
var ADMIN_HOOK = 'addLockedAdminMenu();';

function onOpen() {
  seedClientUrls_();
  var sheet = SpreadsheetApp.getActive().getSheetByName(URL_SHEET_NAME);
  if (sheet) applyUrlValidation_(sheet);
  SpreadsheetApp.getUi()
    .createMenu('Deploy')
    .addItem('Update client copies', 'deployClientCopies')
    .addToUi();
}

function seedClientUrls_() {
  if (!SEEDED_CLIENT_URLS.length) return;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(URL_SHEET_NAME) || spreadsheet.insertSheet(URL_SHEET_NAME);
  if (sheet.getLastRow() > 1) return;
  var rows = [['URL', 'Status', 'Script ID']];
  for (var index = 0; index < SEEDED_CLIENT_URLS.length; index++) {
    rows.push([SEEDED_CLIENT_URLS[index], '', '']);
  }
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
}

function deployClientCopies() {
  seedClientUrls_();
  var sheet = SpreadsheetApp.getActive().getSheetByName(URL_SHEET_NAME);
  if (!sheet) throw new Error('Add a sheet named "Client URLs" with one spreadsheet URL per row.');
  applyUrlValidation_(sheet);

  var rows = sheet.getDataRange().getValues();
  var pending = [];
  var invalidCount = 0;
  var sawUrl = false;
  for (var index = 1; index < rows.length; index++) {
    var url = String(rows[index][0] || '').trim();
    if (!url) continue;
    sawUrl = true;
    if (String(rows[index][1] || '').trim() === 'ok') continue;
    var urlError = clientUrlError_(url);
    if (urlError) {
      invalidCount++;
      writeDeployResult_(sheet, index, { status: urlError, scriptId: '' });
      continue;
    }
    pending.push({ index: index, url: url });
  }
  SpreadsheetApp.flush();
  if (!pending.length) {
    var message = 'Paste each Google Sheets URL in column A.';
    if (invalidCount) message = 'Column A has an invalid URL. Use a link that starts with https://docs.google.com/spreadsheets/d/.';
    else if (sawUrl) message = 'Every URL is already updated.';
    SpreadsheetApp.getUi().alert(message);
    return;
  }

  var adminSource = adminSourceFromMaster_();
  for (var pendingIndex = 0; pendingIndex < pending.length; pendingIndex++) {
    var item = pending[pendingIndex];
    try {
      writeDeployResult_(sheet, item.index, deployOneClient_(item.url, adminSource));
    } catch (error) {
      writeDeployResult_(sheet, item.index, { status: String(error.message || error), scriptId: '' });
    }
    SpreadsheetApp.flush();
  }
}

function applyUrlValidation_(sheet) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(A2="",REGEXMATCH(A2,"^https://docs\\.google\\.com/spreadsheets/d/[a-zA-Z0-9-_]+"))')
    .setAllowInvalid(false)
    .setHelpText('Paste a Google Sheets URL: https://docs.google.com/spreadsheets/d/...')
    .build();
  sheet.getRange('A2:A500').setDataValidation(rule);
}

function clientUrlError_(url) {
  if (/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/.test(url)) return '';
  return 'Invalid Google Sheets URL';
}

function deployOneClient_(url, adminSource) {
  var spreadsheetId = spreadsheetIdFromUrl_(url);
  var scriptId = findOrCreateBoundScript_(spreadsheetId);
  return deployScriptId_(scriptId, adminSource);
}

function deployScriptId_(scriptId, adminSource) {
  var content = scriptApi_('projects/' + scriptId + '/content', 'get');
  var files = sanitizeFiles_(content.files || []);
  ensureManifest_(files);
  if (!adminLivesInCode_(files)) {
    upsertFile_(files, ADMIN_FILE_NAME, 'SERVER_JS', adminSource);
    ensureAdminHook_(files);
  }
  scriptApi_('projects/' + scriptId + '/content', 'put', { files: files });
  return { status: 'ok', scriptId: scriptId };
}

function adminSourceFromMaster_() {
  var content = scriptApi_('projects/' + MASTER_SCRIPT_ID + '/content', 'get');
  var files = content.files || [];
  for (var index = 0; index < files.length; index++) {
    if (files[index].name === 'Code' && files[index].source.indexOf('function addLockedAdminMenu') !== -1) {
      return stripOnOpen_(files[index].source);
    }
  }
  throw new Error('Master project has no Code file with addLockedAdminMenu.');
}

function findOrCreateBoundScript_(spreadsheetId) {
  var found = findBoundScriptId_(spreadsheetId);
  if (found) return found;
  throw new Error('No Apps Script project is visible for this spreadsheet. Open it once in Apps Script so the deploy account can see the bound project.');
}

function findBoundScriptId_(spreadsheetId) {
  var pageToken = '';
  var checked = 0;
  do {
    var url = 'https://www.googleapis.com/drive/v3/files?pageSize=50&fields=nextPageToken,files(id)&q=' +
      encodeURIComponent("mimeType='application/vnd.google-apps.script'");
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    var listed = googleApi_(url, 'get');
    var files = listed.files || [];
    for (var index = 0; index < files.length && checked < 200; index++) {
      checked++;
      var project = scriptApi_('projects/' + files[index].id, 'get');
      if (project.parentId === spreadsheetId) return files[index].id;
    }
    pageToken = checked >= 200 ? '' : (listed.nextPageToken || '');
  } while (pageToken);
  return '';
}

function googleApi_(url, method, payload) {
  var response = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  var body = response.getContentText();
  var parsed = body ? JSON.parse(body) : {};
  if (response.getResponseCode() >= 300) {
    throw new Error((parsed.error && parsed.error.message) || body);
  }
  return parsed;
}

function ensureManifest_(files) {
  var manifest = findFile_(files, 'appsscript');
  if (!manifest) {
    files.push({
      name: 'appsscript',
      type: 'JSON',
      source: JSON.stringify({
        timeZone: 'America/New_York',
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8',
        dependencies: { libraries: [PROSPR_LIBRARY] }
      }, null, 2)
    });
    return;
  }

  var config = JSON.parse(manifest.source);
  config.runtimeVersion = 'V8';
  config.dependencies = config.dependencies || {};
  config.dependencies.libraries = config.dependencies.libraries || [];
  var libraries = config.dependencies.libraries;
  var linked = false;
  for (var index = 0; index < libraries.length; index++) {
    if (libraries[index].userSymbol === PROSPR_LIBRARY.userSymbol) linked = true;
  }
  if (!linked) libraries.push(PROSPR_LIBRARY);
  manifest.source = JSON.stringify(config, null, 2);
}

function adminLivesInCode_(files) {
  var code = findFile_(files, 'Code');
  return !!(code && code.source.indexOf('function addLockedAdminMenu') !== -1);
}

function ensureAdminHook_(files) {
  for (var index = 0; index < files.length; index++) {
    if (files[index].name === ADMIN_FILE_NAME) continue;
    var source = files[index].source || '';
    if (source.indexOf('function onOpen') === -1) continue;
    files[index].source = injectOnOpenCall_(source, ADMIN_HOOK);
    return;
  }
  files.push({
    name: 'AdminEntry',
    type: 'SERVER_JS',
    source: 'function onOpen() {\n  ' + ADMIN_HOOK + '\n}\n'
  });
}

function injectOnOpenCall_(source, call) {
  if (source.indexOf(call.replace(/\(\);$/, '')) !== -1) return source;
  return source.replace(/function onOpen\(\)\s*\{/, 'function onOpen() {\n  ' + call);
}

function stripOnOpen_(source) {
  return source.replace(/function onOpen\(\) \{\n(?:.*\n)*?\}\n\n?/, '');
}

function upsertFile_(files, name, type, source) {
  var existing = findFile_(files, name);
  if (existing) {
    existing.source = source;
    existing.type = type;
    return;
  }
  files.push({ name: name, type: type, source: source });
}

function findFile_(files, name) {
  for (var index = 0; index < files.length; index++) {
    if (files[index].name === name) return files[index];
  }
  return null;
}

function sanitizeFiles_(files) {
  var clean = [];
  for (var index = 0; index < files.length; index++) {
    clean.push({
      name: files[index].name,
      type: files[index].type,
      source: files[index].source
    });
  }
  return clean;
}

function spreadsheetIdFromUrl_(url) {
  var match = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Not a Google Sheets URL: ' + url);
  return match[1];
}

function writeDeployResult_(sheet, rowIndex, result) {
  sheet.getRange(rowIndex + 1, 2).setValue(result.status);
  sheet.getRange(rowIndex + 1, 3).setValue(result.scriptId || '');
}

function scriptApi_(path, method, payload) {
  var response = UrlFetchApp.fetch('https://script.googleapis.com/v1/' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  var body = response.getContentText();
  var parsed = body ? JSON.parse(body) : {};
  if (response.getResponseCode() >= 300) {
    throw new Error((parsed.error && parsed.error.message) || body);
  }
  return parsed;
}

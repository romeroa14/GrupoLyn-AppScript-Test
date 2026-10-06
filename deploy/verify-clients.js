const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const token = JSON.parse(fs.readFileSync(os.homedir() + '/.clasprc.json', 'utf8')).tokens.default.access_token;
const MASTER_SCRIPT_ID = '1zoymvQblIfvs0OpfS19s0ZZg9iQZWfRuE5zmI3Z-KrXETq5v5DzZaTkt';
const CONTROLLER_SHEET_ID = '1BEW_HKx9ITPj13IsIauEFPS_dzkRkCQlJEl3lfuqU7A';

function api(method, url, payload) {
  const args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + token, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
  if (payload) args.push('--data', JSON.stringify(payload));
  args.push(url);
  const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  const splitAt = output.lastIndexOf('\n');
  const status = Number(output.slice(splitAt + 1));
  const text = output.slice(0, splitAt);
  const body = text ? JSON.parse(text) : {};
  if (status >= 300) {
    const message = body.error && body.error.message ? body.error.message : text.slice(0, 400);
    throw new Error(status + ' ' + message);
  }
  return body;
}

function createSpreadsheet(name) {
  return api('POST', 'https://www.googleapis.com/drive/v3/files', {
    name: name,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  }).id;
}

function putContent(scriptId, files) {
  api('PUT', 'https://script.googleapis.com/v1/projects/' + scriptId + '/content', { files: files });
}

function createBoundScript(spreadsheetId, title, files) {
  const created = api('POST', 'https://script.googleapis.com/v1/projects', {
    title: title,
    parentId: spreadsheetId
  });
  putContent(created.scriptId, files);
  return created.scriptId;
}

function baselineFiles(masterFiles) {
  return masterFiles.filter(function (file) {
    return file.name !== 'GrupoLynAdmin';
  }).map(function (file) {
    if (file.name === 'Code') {
      return {
        name: 'Code',
        type: 'SERVER_JS',
        source: 'function onOpen() {\n  ProsprScript.onOpen();\n}\n'
      };
    }
    if (file.name === 'appsscript') {
      const config = JSON.parse(file.source);
      config.runtimeVersion = 'DEPRECATED_ES5';
      return { name: file.name, type: file.type, source: JSON.stringify(config, null, 2) };
    }
    return { name: file.name, type: file.type, source: file.source };
  });
}

function makeSheet() {
  const cells = {};
  function key(row, column) { return row + ',' + column; }
  const sheet = {
    getLastRow: function () {
      return Object.keys(cells).reduce(function (max, item) {
        return Math.max(max, Number(item.split(',')[0]));
      }, 0);
    },
    getDataRange: function () {
      return {
        getValues: function () {
          const last = Math.max(sheet.getLastRow(), 1);
          const rows = [];
          for (let row = 1; row <= last; row++) {
            rows.push([cells[key(row, 1)] || '', cells[key(row, 2)] || '', cells[key(row, 3)] || '']);
          }
          return rows;
        }
      };
    },
    getRange: function (row, column) {
      return {
        setValue: function (value) { cells[key(row, column)] = value; },
        setValues: function (matrix) {
          matrix.forEach(function (line, rowOffset) {
            line.forEach(function (value, columnOffset) {
              cells[key(row + rowOffset, column + columnOffset)] = value;
            });
          });
        }
      };
    }
  };
  return sheet;
}

function main() {
  const master = api('GET', 'https://script.googleapis.com/v1/projects/' + MASTER_SCRIPT_ID + '/content');
  const urls = [];
  for (let index = 1; index <= 3; index++) {
    const spreadsheetId = createSpreadsheet('GrupoLyN Client Copy ' + index);
    const scriptId = createBoundScript(spreadsheetId, 'GrupoLyN Client Copy ' + index, baselineFiles(master.files));
    const before = api('GET', 'https://script.googleapis.com/v1/projects/' + scriptId + '/content');
    const beforeCode = before.files.find(function (file) { return file.name === 'Code'; }).source;
    if (beforeCode.indexOf('addLockedAdminMenu') !== -1) throw new Error('baseline already has admin');
    urls.push('https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit');
    console.log('baseline', index, spreadsheetId, scriptId);
  }

  const source = fs.readFileSync('deploy/MassDeploy.js', 'utf8').replace(
    'var SEEDED_CLIENT_URLS = [];',
    'var SEEDED_CLIENT_URLS = ' + JSON.stringify(urls) + ';'
  );
  fs.writeFileSync('deploy/MassDeploy.js', source);

  const controllerScriptId = createBoundScript(CONTROLLER_SHEET_ID, 'GrupoLyN Deploy', [
    { name: 'Code', type: 'SERVER_JS', source: source },
    { name: 'appsscript', type: 'JSON', source: fs.readFileSync('deploy/appsscript.json', 'utf8') }
  ]);
  fs.writeFileSync('deploy/.clasp.json', JSON.stringify({
    scriptId: controllerScriptId,
    rootDir: '',
    scriptExtensions: ['.js', '.gs'],
    htmlExtensions: ['.html'],
    jsonExtensions: ['.json'],
    filePushOrder: [],
    skipSubdirectories: false
  }, null, 2));
  console.log('controller', controllerScriptId, CONTROLLER_SHEET_ID);

  const sheet = makeSheet();
  const context = {
    UrlFetchApp: {
      fetch: function (url, options) {
        const method = ((options && options.method) || 'get').toUpperCase();
        const args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + token, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
        if (options && options.payload) args.push('--data', options.payload);
        args.push(url);
        const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
        const splitAt = output.lastIndexOf('\n');
        const status = Number(output.slice(splitAt + 1));
        const text = output.slice(0, splitAt);
        return {
          getResponseCode: function () { return status; },
          getContentText: function () { return text; }
        };
      }
    },
    ScriptApp: { getOAuthToken: function () { return token; } },
    SpreadsheetApp: {
      getActive: function () { return { getSheetByName: function () { return sheet; }, insertSheet: function () { return sheet; } }; },
      flush: function () {}
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.deployClientCopies();
  console.log('sheet rows', JSON.stringify(sheet.getDataRange().getValues()));

  urls.forEach(function (url) {
    const spreadsheetId = url.match(/\/d\/([^/]+)/)[1];
    let scriptId = '';
    let pageToken = '';
    do {
      const listed = api('GET', 'https://script.googleapis.com/v1/projects?pageSize=50' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      (listed.projects || []).forEach(function (project) {
        if (project.parentId === spreadsheetId) scriptId = project.scriptId;
      });
      pageToken = scriptId ? '' : (listed.nextPageToken || '');
    } while (pageToken);
    const content = api('GET', 'https://script.googleapis.com/v1/projects/' + scriptId + '/content');
    const names = content.files.map(function (file) { return file.name; }).sort();
    const manifest = JSON.parse(content.files.find(function (file) { return file.name === 'appsscript'; }).source);
    const code = content.files.find(function (file) { return file.name === 'Code'; }).source;
    const admin = content.files.find(function (file) { return file.name === 'GrupoLynAdmin'; });
    const library = (manifest.dependencies.libraries || []).find(function (item) { return item.userSymbol === 'ProsprScript'; });
    console.log(JSON.stringify({
      url: url,
      files: names,
      runtime: manifest.runtimeVersion,
      library: library && library.userSymbol + '@' + library.version,
      onOpenCallsAdmin: code.indexOf('addLockedAdminMenu();') !== -1,
      keepsProsprCall: code.indexOf('ProsprScript.onOpen') !== -1,
      reportInjected: !!(admin && admin.source.indexOf('function runMonthlyComparativeReport') !== -1),
      adminFileHasOnOpen: !!(admin && admin.source.indexOf('function onOpen') !== -1),
      chartsKept: names.indexOf('charts') !== -1
    }));
  });
}

main();

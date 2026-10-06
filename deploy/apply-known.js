const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const token = JSON.parse(fs.readFileSync(os.homedir() + '/.clasprc.json', 'utf8')).tokens.default.access_token;
const targets = [
  '1dT5ZW2Fy99hdlzUMOIPO2zSV2WqsRy1uhD3jPONZZCOpjgoBuJM2KLVP',
  '1Fj64W2KFWSM92FjSbEtJupEhDZTs6vdslDwiPHCgqjnpmi4Y_Zv2gePX',
  '1PVyJT1zu8brFiQp2tUVH8ijFPdMPXTAipB0U6hNwEdm6AcQFNf-WdU6N'
];
const controllerId = '1RkS-Z524kJqDC_eOYusVI3fRsleaX8h06u6Eq_s2gciOzKhKEw7C6fv1';
const masterId = '1zoymvQblIfvs0OpfS19s0ZZg9iQZWfRuE5zmI3Z-KrXETq5v5DzZaTkt';

function curl(method, url, payload) {
  const args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + token, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
  if (payload) args.push('--data', payload);
  args.push(url);
  const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  const splitAt = output.lastIndexOf('\n');
  const status = Number(output.slice(splitAt + 1));
  const text = output.slice(0, splitAt);
  if (status >= 300) throw new Error(status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

const source = fs.readFileSync('deploy/MassDeploy.js', 'utf8');
const context = {
  UrlFetchApp: {
    fetch: function (url, options) {
      const method = ((options && options.method) || 'get').toUpperCase();
      const args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + token, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
      if (options && options.payload) args.push('--data', options.payload);
      args.push(url);
      const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
      const splitAt = output.lastIndexOf('\n');
      return {
        getResponseCode: function () { return Number(output.slice(splitAt + 1)); },
        getContentText: function () { return output.slice(0, splitAt); }
      };
    }
  },
  ScriptApp: { getOAuthToken: function () { return token; } }
};
vm.createContext(context);
vm.runInContext(source, context);

const master = curl('GET', 'https://script.googleapis.com/v1/projects/' + masterId + '/content');
const adminSource = context.stripOnOpen_(master.files.find(function (file) { return file.name === 'Code'; }).source);
targets.forEach(function (scriptId) {
  const result = context.deployScriptId_(scriptId, adminSource);
  console.log('updated', result.status, result.scriptId);
});

curl('PUT', 'https://script.googleapis.com/v1/projects/' + controllerId + '/content', JSON.stringify({
  files: [
    { name: 'Code', type: 'SERVER_JS', source: source },
    { name: 'appsscript', type: 'JSON', source: fs.readFileSync('deploy/appsscript.json', 'utf8') }
  ]
}));
console.log('controller updated');

targets.forEach(function (scriptId) {
  const content = curl('GET', 'https://script.googleapis.com/v1/projects/' + scriptId + '/content');
  const names = content.files.map(function (file) { return file.name; }).sort();
  const manifest = JSON.parse(content.files.find(function (file) { return file.name === 'appsscript'; }).source);
  const code = content.files.find(function (file) { return file.name === 'Code'; }).source;
  const admin = content.files.find(function (file) { return file.name === 'GrupoLynAdmin'; });
  const library = (manifest.dependencies.libraries || []).find(function (item) { return item.userSymbol === 'ProsprScript'; });
  console.log(JSON.stringify({
    scriptId: scriptId,
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

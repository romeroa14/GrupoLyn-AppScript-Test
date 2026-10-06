var BUDGET_SHEET_NAME = 'Monthly Budget';
var INITIAL_ADMIN_CODE = 'grupolyn';
var DEVIATION_THRESHOLD = 0.15;
var GROUP_COLUMN = 1;
var ITEM_COLUMN = 2;
var PLANNED_COLUMN = 3;
var ACTUAL_COLUMN = 5;
var FIRST_BUDGET_ROW = 6;
var REPORT_HEADER_ROW = 5;
var REPORT_COLUMN_COUNT = 7;

function onOpen() {
  addLockedAdminMenu();
}

function loadProsprMenus() {
  removeProsprOpenTrigger();
}

function removeProsprOpenTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var index = 0; index < triggers.length; index++) {
    if (triggers[index].getHandlerFunction() === 'loadProsprMenus') {
      ScriptApp.deleteTrigger(triggers[index]);
    }
  }
}

function addLockedAdminMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Admin')
    .addItem('Enable with admin code', 'showAdminPrompt')
    .addToUi();
}

function showAdminPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Admin Access',
    'Please enter the admin code to unlock admin options:',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  if (response.getResponseText().trim() !== INITIAL_ADMIN_CODE) {
    ui.alert('Incorrect code.');
    return;
  }
  try {
    removeProsprOpenTrigger();
  } catch (error) {
    Logger.log(error);
  }
  addUnlockedAdminMenu();
  ui.alert('Admin enabled. Use Monthly Comparative Report.');
}

function addUnlockedAdminMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Admin')
    .addItem('Monthly Comparative Report', 'runMonthlyComparativeReport')
    .addItem('Require admin code again', 'resetAdminMenu')
    .addToUi();
}

function resetAdminMenu() {
  addLockedAdminMenu();
  SpreadsheetApp.getUi().alert('Admin menu locked again.');
}

function runMonthlyComparativeReport() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BUDGET_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Error: Sheet "' + BUDGET_SHEET_NAME + '" not found.');
    return;
  }

  var period = readBudgetPeriod(sheet);
  var categories = parseBudgetCategories(sheet);
  var table = buildComparisonTable(categories);
  var reportName = writeComparisonSheet(table, period);
  SpreadsheetApp.getUi().alert('Report generated successfully in the "' + reportName + '" sheet.');
  createComparisonDraft(buildEmailBody(categories, period), period.month + ' ' + period.year + ' Budget Comparison');
}

function readBudgetPeriod(sheet) {
  return {
    year: sheet.getRange('F2').getValue(),
    month: sheet.getRange('F3').getValue(),
    bom: sheet.getRange('H2').getValue(),
    eom: sheet.getRange('H3').getValue()
  };
}

function parseBudgetCategories(sheet) {
  var values = sheet.getDataRange().getValues();
  var categories = [];
  var current = null;

  for (var index = FIRST_BUDGET_ROW; index < values.length; index++) {
    var groupLabel = cellText(values[index][GROUP_COLUMN]);
    var itemLabel = cellText(values[index][ITEM_COLUMN]);
    var planned = toNumber(values[index][PLANNED_COLUMN]);
    var actual = toNumber(values[index][ACTUAL_COLUMN]);

    if (isTotalLabel(groupLabel)) {
      if (!current) continue;
      current.planned = planned;
      current.actual = actual;
      categories.push(current);
      current = null;
      continue;
    }

    if (isGroupLabel(groupLabel)) {
      if (current) categories.push(current);
      current = { name: groupLabel, planned: 0, actual: 0, items: [] };
      continue;
    }

    if (current && isLineItem(itemLabel) && !sheet.isRowHiddenByUser(index + 1)) {
      current.items.push({ name: itemLabel, planned: planned, actual: actual });
    }
  }

  if (current) categories.push(current);
  return categories;
}

function buildComparisonTable(categories) {
  var rows = [comparisonRow('header', ['Category', 'Item Description', 'Actual', 'Planned', 'Deviation ($)', 'Deviation (%)', 'Status'])];
  for (var index = 0; index < categories.length; index++) {
    rows = rows.concat(rowsForCategory(categories[index]));
  }
  return rows;
}

function rowsForCategory(category) {
  var ratio = deviationRatio(category.actual, category.planned);
  var rows = [comparisonRow('category', [
    category.name,
    '',
    category.actual,
    category.planned,
    category.actual - category.planned,
    ratio,
    deviationStatus(ratio)
  ])];

  if (deviationStatus(ratio) !== 'OK') {
    rows.push(comparisonRow('note', [deviationSentence(category, ratio), '', '', '', '', '', '']));
    var items = significantItems(category);
    for (var index = 0; index < items.length; index++) {
      rows.push(itemRow(items[index]));
    }
  }

  rows.push(comparisonRow('gap', ['', '', '', '', '', '', '']));
  return rows;
}

function itemRow(item) {
  var ratio = deviationRatio(item.actual, item.planned);
  return comparisonRow('item', ['', item.name, item.actual, item.planned, item.actual - item.planned, ratio, '']);
}

function significantItems(category) {
  var items = [];
  for (var index = 0; index < category.items.length; index++) {
    var item = category.items[index];
    if (deviationStatus(deviationRatio(item.actual, item.planned)) !== 'OK') items.push(item);
  }
  return items;
}

function buildEmailBody(categories, period) {
  var lines = [
    'Monthly Budget Deviation Report',
    'Period: ' + period.month + ' ' + period.year + ' (' + prettyDate(period.bom) + ' - ' + prettyDate(period.eom) + ')',
    'Generated on: ' + prettyDate(new Date()),
    ''
  ];
  for (var index = 0; index < categories.length; index++) {
    lines = lines.concat(emailLinesForCategory(categories[index]));
  }
  return lines.join('\n');
}

function emailLinesForCategory(category) {
  var ratio = deviationRatio(category.actual, category.planned);
  if (deviationStatus(ratio) === 'OK') {
    return [category.name + ': ' + formatMoney(category.actual) + ' actual vs ' + formatMoney(category.planned) + ' planned'];
  }

  var lines = [deviationSentence(category, ratio)];
  var items = significantItems(category);
  for (var index = 0; index < items.length; index++) {
    var item = items[index];
    lines.push('- ' + item.name + ': ' + formatMoney(item.actual) + ' (Actual) vs ' + formatMoney(item.planned) + ' (Planned)');
  }
  lines.push('');
  return lines;
}

function writeComparisonSheet(table, period) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var reportName = period.month + ' Budget Comparison';
  var sheet = spreadsheet.getSheetByName(reportName) || spreadsheet.insertSheet(reportName);
  sheet.clear();
  writePeriodHeader(sheet, period);
  sheet.getRange(REPORT_HEADER_ROW, 1, table.length, REPORT_COLUMN_COUNT).setValues(tableValues(table));
  formatComparisonSheet(sheet, table);
  spreadsheet.setActiveSheet(sheet);
  return reportName;
}

function writePeriodHeader(sheet, period) {
  sheet.getRange('C2').setValue('Year');
  sheet.getRange('D2').setValue(period.year);
  sheet.getRange('E2').setValue('BOM');
  sheet.getRange('F2').setValue(prettyDate(period.bom, 'M/d/yyyy'));
  sheet.getRange('C3').setValue('Month');
  sheet.getRange('D3').setValue(period.month);
  sheet.getRange('E3').setValue('EOM');
  sheet.getRange('F3').setValue(prettyDate(period.eom, 'M/d/yyyy'));
}

function formatComparisonSheet(sheet, table) {
  var header = sheet.getRange(REPORT_HEADER_ROW, 1, 1, REPORT_COLUMN_COUNT);
  header.setFontWeight('bold').setBackground('#e3e3e3').setFontFamily('Arial');

  for (var index = 1; index < table.length; index++) {
    styleComparisonRow(sheet.getRange(REPORT_HEADER_ROW + index, 1, 1, REPORT_COLUMN_COUNT), table[index]);
  }

  var dataRows = table.length - 1;
  if (dataRows < 1) return;
  sheet.getRange(REPORT_HEADER_ROW + 1, 3, dataRows, 2).setNumberFormat('$#,##0.00');
  sheet.getRange(REPORT_HEADER_ROW + 1, 5, dataRows, 1).setNumberFormat('+$#,##0.00;-$#,##0.00;"$"0.00');
  sheet.getRange(REPORT_HEADER_ROW + 1, 6, dataRows, 1).setNumberFormat('+0.0%;-0.0%;0.0%');
  sheet.getRange(REPORT_HEADER_ROW, 3, table.length, 4).setHorizontalAlignment('right');
  for (var column = 1; column <= REPORT_COLUMN_COUNT; column++) sheet.autoResizeColumn(column);
}

function styleComparisonRow(range, entry) {
  range.setFontFamily('Arial');
  if (entry.kind === 'gap') {
    range.setBackground('#ffffff');
    return;
  }
  if (entry.kind === 'note') {
    range.setBackground('#fff4d6').setFontStyle('italic');
    return;
  }
  if (entry.kind === 'item') {
    range.setBackground('#ffe08a').setFontWeight('bold');
    return;
  }
  if (entry.kind !== 'category') return;

  range.setBackground('#f0f8ff');
  range.getCell(1, 1).setFontWeight('bold').setFontLine('underline');
  var status = entry.values[6];
  if (status === 'Over') range.getCell(1, 7).setBackground('#ffd6d6');
  if (status === 'Under') range.getCell(1, 7).setBackground('#d6ffd6');
}

function createComparisonDraft(content, subject) {
  try {
    GmailApp.createDraft('', subject, '', { htmlBody: '<pre>' + escapeHtml(content) + '</pre>' });
    SpreadsheetApp.getUi().alert('Report has been saved as a draft in your Gmail.');
  } catch (error) {
    SpreadsheetApp.getUi().alert('Could not create Gmail draft. Grant Gmail permission and try again. Error: ' + error.message);
  }
}

function comparisonRow(kind, values) {
  return { kind: kind, values: values };
}

function tableValues(table) {
  var values = [];
  for (var index = 0; index < table.length; index++) values.push(table[index].values);
  return values;
}

function deviationRatio(actual, planned) {
  if (planned === 0) return actual === 0 ? 0 : (actual > 0 ? 1 : -1);
  return (actual - planned) / planned;
}

function deviationStatus(ratio) {
  if (Math.abs(ratio) < DEVIATION_THRESHOLD) return 'OK';
  return ratio > 0 ? 'Over' : 'Under';
}

function deviationSentence(category, ratio) {
  var direction = ratio > 0 ? 'over' : 'under';
  return category.name + ' is ' + direction + ' budget by ' + Math.abs(ratio * 100).toFixed(1) + '%.';
}

function isTotalLabel(label) {
  return label.indexOf('Total') === 0;
}

function isGroupLabel(label) {
  return label && !isTotalLabel(label) && label !== 'Monthly Budget' && label !== 'Detail View';
}

function isLineItem(label) {
  return label && label !== '-' && label !== 'Detail View';
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toNumber(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  var text = cellText(value).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!text || text === '-') return 0;
  var parsed = parseFloat(text);
  return isFinite(parsed) ? parsed : 0;
}

function formatMoney(amount) {
  var sign = amount < 0 ? '-' : '';
  return sign + '$' + Math.abs(amount).toFixed(2);
}

function prettyDate(value, pattern) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return value;
  return Utilities.formatDate(value, Session.getScriptTimeZone(), pattern || 'MM/dd/yyyy');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

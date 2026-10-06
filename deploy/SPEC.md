# Mass deploy contract

The controller spreadsheet is not a client plan. Its script reads `Client URLs` and updates other spreadsheets through the Apps Script API.

For each URL the script must:

- Keep every existing script file except the admin injection.
- Link `ProsprScript` version 39 only when that library symbol is missing.
- Set `runtimeVersion` to `V8`.
- Write `GrupoLynAdmin.js` from the master project's `Code.js`, without `onOpen`.
- Call `addLockedAdminMenu()` from the client's existing `onOpen`.
- Leave an existing `ProsprScript.onOpen()` call in place, and not add one.
- Skip a second copy of the admin functions when `Code.js` already defines `addLockedAdminMenu`.
- Record `ok` or the error on that row before continuing.

The Apps Script API no longer has `projects.list`. The controller finds an existing bound script by scanning Drive files of type script and reading each project's `parentId`. It does not create a second script on a sheet that already has one, because that call succeeds and leaves an extra project. The three verification copies were created by this account, so their script ids are known and were updated directly.

## Verified run

Three spreadsheets were created without the Admin code, then the controller updated their bound scripts. Each result is runtime V8, ProsprScript version 39, the original chart and bucket files kept, and `GrupoLynAdmin` present with the monthly report. The client sheets do not contain the financial template data because copying that file needs a broader Drive permission than the current login.

- https://docs.google.com/spreadsheets/d/1PlkJJedBjg8sJ2KdnC_ExpSP5L05kau-cNXEHr85mqU/edit
- https://docs.google.com/spreadsheets/d/1eMww-F741r4IDR9KsWrJQj0B_KrrcUDFGSgaR9HJ5UA/edit
- https://docs.google.com/spreadsheets/d/15OWz903rm65bs8w3qmuosy3MpEKwMCo3ZHVEkMpqNZc/edit

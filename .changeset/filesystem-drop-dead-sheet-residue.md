---
'@epicenter/filesystem': minor
---

Breaking (pre-1.0): remove the dead sheet residue left by ADR-0106. The refused spreadsheet body never shipped a consumer, so the reorder helpers and sheet-shaped identifiers had zero callers. Removed public exports: `reorderRow`, `reorderColumn` (the whole `formats/sheet.ts` module, including the `computeMidpoint` that ADR-0106 step-2 inlined here on the assumption the module was live), `ColumnDefinition`, `ColumnId`, `RowId`, `generateColumnId`, and `generateRowId`. `FileId` / `asFileId` / `generateFileId` and the markdown format helpers are unchanged.

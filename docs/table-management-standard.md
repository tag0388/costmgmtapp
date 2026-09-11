# Table management standard

All editable data grids in Costwise should follow the same interaction pattern unless the record type is intentionally non-deletable.

## Toolbar

- Search / filters relevant to the table.
- Export to Excel.
- Import from Excel.
- Refresh.
- Bulk edit when the table supports editable business fields.
- Bulk delete when permanent deletion is permitted for that record type.
- Primary create action remains in the page header.

## Row actions

- Edit icon on editable rows.
- Delete icon on deletable rows.
- Checkbox selection for bulk actions.
- Fixed configuration slots, platform-owned identifiers, and records with a deliberate archive/deactivate policy are exceptions to permanent delete.

## Excel export/import

1. Export produces an `.xlsx` workbook using stable import column names.
2. Users can edit the workbook and import it back from the same screen.
3. Import always shows a validation preview before database changes.
4. Validation blocks import for duplicate business keys, missing required fields, invalid controlled-list Value IDs, and field-length violations.
5. `Delete Existing Data` is off by default. If selected, a destructive confirmation must state that replacement deletes existing data and cannot be undone.
6. Without replacement, an existing business key updates its row and a new key inserts a new row.
7. A progress indicator is shown while importing.
8. Attribute assignments in bulk files use the stored **Value ID**, never the display Value Name.
9. Enterprise/project context comes from the active route; users never type internal UUIDs into import files.

## Deletion

Permanent delete must always require confirmation. Where deletion would violate a platform governance rule (for example a system-owned enterprise record) the table should use deactivate/archive instead and should not pretend that action is a delete.

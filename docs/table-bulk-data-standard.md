# Table bulk data standard

This is the default interaction pattern for editable Costwise tables.

## Row and toolbar actions

- Editable rows expose compact Edit and Delete actions at row level.
- Tables expose a selection checkbox per row plus Select All Visible in the header.
- The toolbar exposes bulk Edit and Delete actions when the entity supports them.
- Root/protected records that must not be hard-deleted (for example Enterprises) use Deactivate instead of Delete.
- Destructive actions always require a confirmation dialog and explain cascading impact where applicable.

## Excel export/import

Data-heavy tables and value lists should provide Export and Import icons in the toolbar/editor.

1. Export produces an `.xlsx` workbook using stable import column names.
2. Import reads the first worksheet and shows a preview before any database write.
3. Validation runs before import. Blocking errors include missing required fields, duplicate business keys, invalid controlled values, and field length limits.
4. Import is disabled until all blocking errors are fixed in Excel and the file is selected again.
5. `Delete Existing Data` is optional. When enabled, a second destructive confirmation is required before replacement.
6. Without replacement, rows are matched by a stable key and updated; unmatched rows are inserted; omitted database rows remain unchanged.
7. With replacement, existing rows in the current screen context are removed first and the workbook becomes the new dataset.
8. A progress bar is shown while writes are running.
9. On success, the table and shared context selectors refresh immediately.

## Context and identifiers

- Enterprise/project context comes from the current scoped route; users do not re-enter IDs in import files.
- Public IDs may be exported where they are needed as stable row identifiers.
- Enterprise Project attribute columns use stable slot headers `E01` through `E20` in Excel.
- Project attribute cells contain **Value ID only**, never Value Name. Value Name remains presentation metadata.

## Safety

- Preview/validation happens before destructive writes.
- Duplicate keys are case-insensitive where the database treats them as business identifiers.
- Replace operations explain their scope and downstream/cascade impact.
- Import implementations must preserve the current enterprise/project scope and must not infer scope from workbook text.

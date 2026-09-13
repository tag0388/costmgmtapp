# Enterprise Resource Rates

Enterprise Resource Rates are enterprise-owned master data stored in `public.enterprise_resource_rates`.

## Business key

`Resource ID` is unique within an enterprise, case-insensitively. The same Resource ID may be used by a different enterprise.

## Columns

- Resource ID — required, max 40 characters
- Resource Name — required, max 120 characters
- Category — Labour, Staff, Plant, or Material
- Rate — numeric, greater than or equal to zero
- Unit — required, max 30 characters
- Extra 1–Extra 5 — optional free text, max 255 characters each
- Status — Active / Inactive

## Import / Export

User-facing actions are **Export** and **Import**. Files use `.xlsx` and the exact columns:

`Resource ID`, `Resource Name`, `Category`, `Rate`, `Unit`, `Extra 1`, `Extra 2`, `Extra 3`, `Extra 4`, `Extra 5`, `Status`.

Merge import updates matching Resource IDs and inserts new Resource IDs. Replace import soft-deactivates existing rows before applying the incoming file, preserving historical references.

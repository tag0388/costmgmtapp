# Enterprise Projects management

Enterprise Admin manages project master records within the currently selected enterprise.

## Project identity

Each project has three identifiers with different purposes:

- `projects.id` — internal UUID used for relational keys and integrations.
- `projects.public_id` — stable opaque routing identifier used in browser URLs.
- `projects.project_code` — editable business-facing project code, unique within an enterprise.

Changing a project code does not change the internal UUID or public routing ID.

## Status

Projects use `Active` or `Inactive` status. Inactive projects are retained for reporting and historical data, but are excluded from the normal project selector in the application shell.

## Enterprise Projects screen

The Enterprise Projects page supports:

- listing all projects for the selected enterprise,
- searching by project code or name,
- filtering by status,
- adding projects,
- editing project code, name, and status,
- activating/deactivating projects without deleting data,
- opening an active project directly into its Project Dashboard.

Permanent deletion is intentionally not exposed in the UI.

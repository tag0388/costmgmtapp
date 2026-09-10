# Enterprise and project routing context

Costwise uses three identifiers for enterprise/project records:

- `id`: immutable PostgreSQL UUID primary key for joins and integrations.
- `public_id`: immutable random URL-safe identifier used in browser routes and public APIs.
- `enterprise_code` / `project_code`: human-readable business code.

Canonical routes:

- System scope: `/system-admin/...`
- Enterprise scope: `/enterprises/{enterprise_public_id}/enterprise-admin/...`
- Project scope: `/enterprises/{enterprise_public_id}/projects/{project_public_id}/{module}/{submodule}`

Public IDs are intentionally non-sequential. They improve URL hygiene and reduce casual enumeration, but authorization must still be enforced through authentication and RLS/API authorization.

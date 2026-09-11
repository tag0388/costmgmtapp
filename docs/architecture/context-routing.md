# Enterprise and project context routing

Costwise uses opaque public routing IDs in URLs while retaining UUID primary keys and human-readable business codes in the database.

## Route scopes

- System scope: `/system-admin/...`
- Enterprise scope: `/enterprises/{enterprise_public_id}/enterprise-admin/...`
- Project scope: `/enterprises/{enterprise_public_id}/projects/{project_public_id}/...`

`public_id` is a stable, non-sequential URL/API identifier. It is not an authorization mechanism. Access control must continue to be enforced with authentication, RLS and/or API authorization.

Database UUIDs remain the canonical relational keys. `enterprise_code` and `project_code` remain business-facing identifiers and can be exposed in reporting alongside UUIDs/public IDs where useful.

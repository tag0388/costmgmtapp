# Enterprise and project routing

Use human-readable enterprise/project codes in application URLs while keeping UUID primary keys as immutable database and integration identifiers.

Recommended route shapes:

- System scope: `/system-admin/...`
- Enterprise scope: `/e/{enterprise_code}/enterprise-admin/...`
- Project scope: `/e/{enterprise_code}/p/{project_code}/...`

Examples:

- `/e/WSP/enterprise-admin/settings`
- `/e/LOR/p/J47/cost-management/cost-codes`

The top Enterprise and Project selectors should be populated from Supabase. Changing the Enterprise should update the URL and reload the available projects for that enterprise. Changing Project should update the project segment of the URL.

Do not use enterprise/project names as identifiers because names may change. Codes are suitable for readable routes; UUIDs remain the authoritative keys for joins, APIs, data warehouse facts/dimensions, permissions and audit records.

# Enterprise Projects

Enterprise Projects is the enterprise-scoped administration screen for creating and maintaining project records.

## Behaviour

- Projects belong to exactly one enterprise through the internal `enterprise_id` UUID.
- Project codes are unique within an enterprise, not globally.
- Browser routes use the opaque `public_id` (`prj_...`) rather than the business project code.
- Project status is `Active` or `Inactive`; records are deactivated rather than deleted so historical reporting can be preserved.
- Opening a project routes to `/enterprises/{enterprisePublicId}/projects/{projectPublicId}/project-dashboard/overview`.

## Current security state

The current development environment still uses temporary broad anonymous database access for functional testing. The UI is not an authorization boundary. Authentication and enterprise/project-scoped RLS must be completed before production use.

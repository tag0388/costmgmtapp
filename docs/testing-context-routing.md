# Context routing test checklist

1. Enterprise selector shows live enterprises from Supabase.
2. Project selector shows projects belonging only to the selected enterprise.
3. Enterprise Admin routes use the enterprise `public_id`.
4. Project modules use both enterprise and project `public_id` values.
5. System Admin remains outside enterprise/project scoped URLs.
6. Enterprise Settings edits name, logo and approved domains only.
7. Approved Domain inputs retain focus while typing.

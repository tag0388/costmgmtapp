# Project Cost Code Attributes

Project Cost Code Attributes use the existing normalized project attribute model:

- `attribute_sets.scope = Project`
- `attribute_sets.project_id = current project`
- `attribute_sets.category = Cost Code`
- stable slots `P01` through `P20`
- Value List definitions stored in `attribute_definitions`
- Value ID / Value Name pairs stored in `attribute_values`
- Cost Code records persist selected Value IDs in `cost_codes.p_attribute_01` through `cost_codes.p_attribute_20`

The settings page supports active/inactive definitions, allowed values, soft-deactivation, and Import / Export using the standard Value ID / Value Name workbook format.

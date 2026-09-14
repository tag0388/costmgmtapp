# Cost Code Attribute Assignment

Cost Management → Cost Codes uses active Project Cost Code Attribute definitions (`scope = Project`, `category = Cost Code`) as dynamic columns.

- Cost Code rows store the selected Value ID in `cost_codes.p_attribute_01` through `p_attribute_20`.
- The grid and edit drawer display the configured Attribute Name and Value Name.
- Only active Value IDs can be newly assigned.
- Existing inactive values remain readable on historical Cost Codes.
- Cost Code Export / Import includes active attribute columns as `Pxx - Attribute Name` and exchanges Value IDs.
- Search includes configured attribute Value IDs and Value Names.

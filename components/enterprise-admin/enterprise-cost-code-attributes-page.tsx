import EnterpriseAttributeDefinitionsPage from "@/components/enterprise-admin/enterprise-attribute-definitions-page";

export default function EnterpriseCostCodeAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  return <EnterpriseAttributeDefinitionsPage
    enterprisePublicId={enterprisePublicId}
    category="Cost Code"
    pageTitle="Enterprise Cost Code Attributes"
    description="Configure up to 20 enterprise-level attributes that can be assigned to cost codes."
    recordLabel="Cost Code"
    filenameSegment="cost-code"
  />;
}

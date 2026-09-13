import EnterpriseAttributeDefinitionsPage from "@/components/enterprise-admin/enterprise-attribute-definitions-page";

export default function EnterpriseChangeAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  return <EnterpriseAttributeDefinitionsPage
    enterprisePublicId={enterprisePublicId}
    category="Change"
    pageTitle="Enterprise Change Attributes"
    description="Configure up to 20 enterprise-level attributes that can be assigned to change records."
    recordLabel="Change"
    filenameSegment="change"
  />;
}

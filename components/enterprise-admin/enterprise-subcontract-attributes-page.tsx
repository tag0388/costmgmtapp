import EnterpriseAttributeDefinitionsPage from "@/components/enterprise-admin/enterprise-attribute-definitions-page";

export default function EnterpriseSubcontractAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  return <EnterpriseAttributeDefinitionsPage
    enterprisePublicId={enterprisePublicId}
    category="Subcontract"
    pageTitle="Enterprise Subcontract Attributes"
    description="Configure up to 20 enterprise-level attributes that can be assigned to subcontracts."
    recordLabel="Subcontract"
    filenameSegment="subcontract"
  />;
}

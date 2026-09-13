import EnterpriseAttributeDefinitionsPage from "@/components/enterprise-admin/enterprise-attribute-definitions-page";

export default function EnterpriseLineItemAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  return <EnterpriseAttributeDefinitionsPage
    enterprisePublicId={enterprisePublicId}
    category="Line Item"
    pageTitle="Enterprise Line-Item Attributes"
    description={(enterpriseName) => `Configure up to 20 enterprise-level attributes for cost and commercial line items in ${enterpriseName}.`}
    recordLabel="Line Item"
    filenameSegment="line-item"
  />;
}

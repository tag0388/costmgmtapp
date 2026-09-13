import EnterpriseAttributeDefinitionsPage from "@/components/enterprise-admin/enterprise-attribute-definitions-page";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  return <EnterpriseAttributeDefinitionsPage
    enterprisePublicId={enterprisePublicId}
    category="Project"
    pageTitle="Enterprise Project Attributes"
    description="Configure up to 20 enterprise-level attributes that can be assigned to projects."
    recordLabel="Project"
    filenameSegment="project"
  />;
}

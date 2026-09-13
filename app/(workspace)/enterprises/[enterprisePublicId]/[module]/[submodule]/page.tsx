import "@/app/system-admin-enterprises.css";
import "@/app/system-admin-enterprises-shell-overrides.css";
import "@/app/enterprise-admin-settings.css";
import "@/app/enterprise-project-attributes.css";
import EnterpriseCalendarsPage from "@/components/enterprise-admin/enterprise-calendars-page";
import EnterpriseChangeAttributesPage from "@/components/enterprise-admin/enterprise-change-attributes-page";
import EnterpriseCostCodeAttributesPage from "@/components/enterprise-admin/enterprise-cost-code-attributes-page";
import EnterpriseLineItemAttributesPage from "@/components/enterprise-admin/enterprise-line-item-attributes-page";
import EnterpriseProjectAttributesPage from "@/components/enterprise-admin/enterprise-project-attributes-page";
import EnterpriseProjectsPage from "@/components/enterprise-admin/enterprise-projects-page";
import EnterpriseResourceRatesPage from "@/components/enterprise-admin/enterprise-resource-rates-page";
import EnterpriseSettingsPage from "@/components/enterprise-admin/enterprise-settings-page";
import EnterpriseSubcontractAttributesPage from "@/components/enterprise-admin/enterprise-subcontract-attributes-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

export default async function EnterpriseContextPage({ params }: { params: Promise<{ enterprisePublicId: string; module: string; submodule: string }> }) {
  const { enterprisePublicId, module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule)) notFound();
  if (module !== "enterprise-admin") notFound();
  if (submodule === "settings") return <EnterpriseSettingsPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "projects") return <EnterpriseProjectsPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "project-attributes") return <EnterpriseProjectAttributesPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "line-item-attributes") return <EnterpriseLineItemAttributesPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "calendars") return <EnterpriseCalendarsPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "cost-code-attributes") return <EnterpriseCostCodeAttributesPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "resource-rates") return <EnterpriseResourceRatesPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "change-attributes") return <EnterpriseChangeAttributesPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "subcontract-attributes") return <EnterpriseSubcontractAttributesPage enterprisePublicId={enterprisePublicId} />;
  return null;
}

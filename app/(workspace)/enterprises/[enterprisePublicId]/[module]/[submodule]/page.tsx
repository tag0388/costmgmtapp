import "@/app/system-admin-enterprises.css";
import "@/app/system-admin-enterprises-shell-overrides.css";
import "@/app/enterprise-admin-settings.css";
import "@/app/enterprise-project-attributes.css";
import "@/app/table-bulk-actions.css";
import EnterpriseProjectAttributesPage from "@/components/enterprise-admin/enterprise-project-attributes-page";
import EnterpriseProjectsPage from "@/components/enterprise-admin/enterprise-projects-page";
import EnterpriseSettingsPage from "@/components/enterprise-admin/enterprise-settings-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

export default async function EnterpriseContextPage({ params }: { params: Promise<{ enterprisePublicId: string; module: string; submodule: string }> }) {
  const { enterprisePublicId, module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule)) notFound();
  if (module !== "enterprise-admin") notFound();
  if (submodule === "settings") return <EnterpriseSettingsPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "projects") return <EnterpriseProjectsPage enterprisePublicId={enterprisePublicId} />;
  if (submodule === "project-attributes") return <EnterpriseProjectAttributesPage enterprisePublicId={enterprisePublicId} />;
  return null;
}

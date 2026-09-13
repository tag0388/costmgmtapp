import "@/app/system-admin-enterprises.css";
import "@/app/enterprise-project-attributes.css";
import ProjectLineItemAttributesPage from "@/components/project-admin/project-line-item-attributes-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

const projectModules = new Set(["project-dashboard", "project-admin", "cost-management", "change-management", "subcontract-management"]);

export default async function ProjectContextPage({ params }: { params: Promise<{ enterprisePublicId: string; projectPublicId: string; module: string; submodule: string }> }) {
  const { projectPublicId, module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule) || !projectModules.has(module)) notFound();
  if (module === "project-admin" && submodule === "line-item-attributes") return <ProjectLineItemAttributesPage projectPublicId={projectPublicId}/>;
  return null;
}

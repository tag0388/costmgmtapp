import "@/app/system-admin-enterprises.css";
import "@/app/enterprise-admin-settings.css";
import "@/app/enterprise-project-attributes.css";
import ProjectGeneralInfoPage from "@/components/project-admin/project-general-info-page";
import ProjectCalendarsPage from "@/components/project-admin/project-calendars-page";
import ProjectLineItemAttributesPage from "@/components/project-admin/project-line-item-attributes-page";
import CostCodesAgGridPage from "@/components/cost-management/cost-codes-ag-grid-page";
import CostReportingPeriodsPage from "@/components/cost-management/cost-reporting-periods-page";
import ProjectCostCodeAttributesPage from "@/components/cost-management/project-cost-code-attributes-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

const projectModules = new Set(["project-dashboard", "project-admin", "cost-management", "change-management", "subcontract-management"]);

export default async function ProjectContextPage({ params }: { params: Promise<{ enterprisePublicId: string; projectPublicId: string; module: string; submodule: string }> }) {
  const { projectPublicId, module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule) || !projectModules.has(module)) notFound();
  if (module === "project-admin" && submodule === "general-info") return <ProjectGeneralInfoPage projectPublicId={projectPublicId}/>;
  if (module === "project-admin" && submodule === "line-item-attributes") return <ProjectLineItemAttributesPage projectPublicId={projectPublicId}/>;
  if (module === "project-admin" && submodule === "calendar") return <ProjectCalendarsPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "cost-codes") return <CostCodesAgGridPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "reporting-periods") return <CostReportingPeriodsPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "cost-code-attributes") return <ProjectCostCodeAttributesPage projectPublicId={projectPublicId}/>;
  return null;
}

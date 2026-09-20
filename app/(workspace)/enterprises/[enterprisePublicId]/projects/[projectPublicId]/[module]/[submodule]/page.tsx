import "@/app/system-admin-enterprises.css";
import "@/app/enterprise-admin-settings.css";
import "@/app/enterprise-project-attributes.css";
import "@/app/change-management.css";
import ProjectGeneralInfoPage from "@/components/project-admin/project-general-info-page";
import ProjectCalendarsPage from "@/components/project-admin/project-calendars-page";
import ProjectLineItemAttributesPage from "@/components/project-admin/project-line-item-attributes-page";
import CostCodesAgGridPage from "@/components/cost-management/cost-codes-ag-grid-page";
import CostTimephasingPage from "@/components/cost-management/timephasing-page";
import CostReportingPeriodsPage from "@/components/cost-management/cost-reporting-periods-page";
import ProjectCostCodeAttributesPage from "@/components/cost-management/project-cost-code-attributes-page";
import ProjectResourceRatesPage from "@/components/cost-management/project-resource-rates-page";
import BaselineBudgetPage from "@/components/cost-management/baseline-budget-page";
import ActualCostPage from "@/components/cost-management/actual-cost-page";
import CostToCompletePage from "@/components/cost-management/cost-to-complete-page";
import ChangeManagementPage from "@/components/change-management/change-management-page";
import SubcontractManagementPage from "@/components/subcontract-management/subcontract-management-page";
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
  if (module === "cost-management" && submodule === "timephasing") return <CostTimephasingPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "reporting-periods") return <CostReportingPeriodsPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "cost-code-attributes") return <ProjectCostCodeAttributesPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "resource-rates") return <ProjectResourceRatesPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "bulk-baseline-budget") return <BaselineBudgetPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "bulk-actual-cost") return <ActualCostPage projectPublicId={projectPublicId}/>;
  if (module === "cost-management" && submodule === "bulk-cost-to-complete") return <CostToCompletePage projectPublicId={projectPublicId}/>;
  if (module === "change-management" && submodule === "change-management") return <ChangeManagementPage projectPublicId={projectPublicId}/>;
  if (module === "change-management" && submodule === "change-attributes") return <ProjectCostCodeAttributesPage projectPublicId={projectPublicId} category="Change"/>;
  if (module === "change-management" && submodule === "bulk-change-records") return <ChangeManagementPage projectPublicId={projectPublicId} bulkRecords/>;
  if (module === "subcontract-management" && submodule === "subcontract-management") return <SubcontractManagementPage projectPublicId={projectPublicId}/>;
  if (module === "subcontract-management" && submodule === "subcontract-attributes") return <ProjectCostCodeAttributesPage projectPublicId={projectPublicId} category="Subcontract"/>;
  if (module === "subcontract-management" && submodule === "bulk-line-items") return <SubcontractManagementPage projectPublicId={projectPublicId} bulkLineItems/>;
  return null;
}

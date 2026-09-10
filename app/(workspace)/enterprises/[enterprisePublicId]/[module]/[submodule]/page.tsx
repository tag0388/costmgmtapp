import "@/app/system-admin-enterprises.css";
import "@/app/system-admin-enterprises-shell-overrides.css";
import "@/app/enterprise-admin-settings.css";
import EnterpriseSettingsPage from "@/components/enterprise-admin/enterprise-settings-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

export default async function EnterpriseContextPage({ params }: { params: Promise<{ enterprisePublicId: string; module: string; submodule: string }> }) {
  const { enterprisePublicId, module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule)) notFound();
  if (module !== "enterprise-admin") notFound();
  if (submodule === "settings") return <EnterpriseSettingsPage enterprisePublicId={enterprisePublicId} />;
  return null;
}

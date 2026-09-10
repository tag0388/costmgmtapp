import "@/app/system-admin-enterprises.css";
import "@/app/system-admin-enterprises-shell-overrides.css";
import "@/app/enterprise-admin-settings.css";
import EnterpriseSettingsPage from "@/components/enterprise-admin/enterprise-settings-page";
import { notFound } from "next/navigation";
import { isSubmoduleSlug } from "@/lib/navigation";

export default async function EnterpriseAdminPage({ params }: { params: Promise<{ enterprisePublicId: string; submodule: string }> }) {
  const { enterprisePublicId, submodule } = await params;
  if (!isSubmoduleSlug("enterprise-admin", submodule)) notFound();
  if (submodule === "settings") return <EnterpriseSettingsPage enterprisePublicId={enterprisePublicId} />;
  return null;
}

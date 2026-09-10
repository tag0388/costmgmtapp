import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug } from "@/lib/navigation";

export default async function ProjectScopedPage({ params }: { params: Promise<{ enterprisePublicId: string; projectPublicId: string; module: string; submodule: string }> }) {
  const { module, submodule } = await params;
  if (!isModuleSlug(module) || module === "system-admin" || module === "enterprise-admin" || module === "my-profile" || !isSubmoduleSlug(module, submodule)) notFound();
  return null;
}

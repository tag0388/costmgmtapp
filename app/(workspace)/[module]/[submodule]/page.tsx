import "@/app/system-admin-enterprises.css";
import EnterprisesPage from "@/components/system-admin/enterprises-page";
import { notFound } from "next/navigation";
import { isModuleSlug, isSubmoduleSlug, routeMap } from "@/lib/navigation";

export function generateStaticParams() {
  return Object.entries(routeMap).flatMap(([module, submodules]) =>
    submodules.map((submodule) => ({ module, submodule })),
  );
}

export default async function SubmodulePage({ params }: PageProps<"/[module]/[submodule]">) {
  const { module, submodule } = await params;
  if (!isModuleSlug(module) || !isSubmoduleSlug(module, submodule)) notFound();
  if (module === "system-admin" && submodule === "enterprises") return <EnterprisesPage />;
  return null;
}

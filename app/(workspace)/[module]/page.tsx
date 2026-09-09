import { notFound, redirect } from "next/navigation";
import { defaultSubmodule, isModuleSlug, routeMap } from "@/lib/navigation";

export function generateStaticParams() {
  return Object.keys(routeMap).map((module) => ({ module }));
}

export default async function ModulePage({ params }: PageProps<"/[module]">) {
  const { module } = await params;
  if (!isModuleSlug(module)) notFound();
  redirect(`/${module}/${defaultSubmodule(module)}`);
}

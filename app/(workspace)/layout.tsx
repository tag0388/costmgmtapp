import AppShellContext from "@/components/app-shell-context";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AppShellContext>{children}</AppShellContext>;
}

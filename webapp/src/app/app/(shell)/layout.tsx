import { AppShell } from "@/components/kerb/AppShell";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}

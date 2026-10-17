import { Workspace } from "@/components/workspace";
export const metadata = { title: "Your workspace" };
export default function Dashboard() {
  return (
    <main className="page-shell" id="main">
      <Workspace />
    </main>
  );
}

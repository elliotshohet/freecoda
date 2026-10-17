import Link from "next/link";
import { Workspace } from "@/components/workspace";
export const metadata = { title: "Your workspace" };
export default function Dashboard() {
  return (
    <main className="page-shell" id="main">
      <section
        className="panel"
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 5px" }}>A workspace in your browser.</h2>
          <p style={{ margin: 0 }}>
            Build with an agent, edit files, and review a private app preview.
          </p>
        </div>
        <Link className="button purple" href="/app">
          Open cloud workspace
        </Link>
      </section>
      <Workspace />
    </main>
  );
}

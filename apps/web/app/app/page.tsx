import { CloudWorkspace } from "./workspace";
export const metadata = {
  title: "Cloud workspace",
  robots: { index: false, follow: false },
};
export default function AppPage() {
  return (
    <main id="main">
      <CloudWorkspace />
    </main>
  );
}

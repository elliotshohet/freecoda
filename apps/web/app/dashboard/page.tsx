import { redirect } from "next/navigation";
export const metadata = { title: "Your workspace" };
export default function Dashboard() {
  redirect("/settings");
}

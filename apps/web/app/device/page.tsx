import { DeviceApproval } from "@/components/device-approval";
export const metadata = { title: "Connect your terminal", robots: { index: false, follow: false } };
export default function DevicePage() {
  return (
    <main className="page-shell" id="main">
      <DeviceApproval />
    </main>
  );
}

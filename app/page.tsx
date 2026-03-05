import MailClient from "./components/MailClient";
import { getBuildVersionLabel } from "@/lib/buildVersion";
import { getAppBranding } from "@/lib/appBranding";

export default function Home() {
  const branding = getAppBranding();
  return (
    <MailClient
      buildVersionLabel={getBuildVersionLabel()}
      appEnvironmentLabel={branding.environmentLabel}
    />
  );
}

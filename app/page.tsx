import MailClient from "./components/MailClient";
import { getBuildVersionLabel } from "@/lib/buildVersion";

export default function Home() {
  return <MailClient buildVersionLabel={getBuildVersionLabel()} />;
}

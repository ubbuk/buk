import { TimeMachineWorkspace } from "@/components/monitoring/time-machine/TimeMachineWorkspace";

// Time Machine + Backup Vault. Access is decided by the section layout (ADMIN /
// DIRECTOR) and, independently, by every /api/admin/time-machine endpoint.
export default function TimeMachinePage() {
  return <TimeMachineWorkspace />;
}

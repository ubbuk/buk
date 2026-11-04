"use client";

import { Camera, History } from "lucide-react";
import { useCallback, useState } from "react";
import { BackupVaultPanel } from "./BackupVaultPanel";
import { HistoricalStatePanel } from "./HistoricalStatePanel";
import { TimeMachinePanel } from "./TimeMachinePanel";
import { useReconstruction, useVault } from "./useTimeMachineApi";

// One workflow across the two machines:
//   Time Machine moment -> reconstruction -> snapshot -> Backup Vault -> verify -> test restore
// Everything shown comes from the API; nothing is stored in the browser.
export function TimeMachineWorkspace() {
  const [asOfMs, setAsOfMs] = useState<number | null>(null);
  const rec = useReconstruction();
  const vault = useVault();

  const onMomentChange = useCallback((ms: number) => setAsOfMs(ms), []);
  const reconstructing = rec.state.status === "loading";
  const busyMachine = reconstructing || vault.busy === "create";

  const actions = (
    <>
      <button type="button" className="tm-btn" disabled={asOfMs === null || reconstructing} onClick={() => asOfMs !== null && rec.run(asOfMs)} title="Audit log-оос тэр мөчийн төлвийг сэргээх (зөвхөн унших)">
        <History className="size-4" aria-hidden />
        {reconstructing ? "Сэргээж байна…" : "Сэргээх"}
      </button>
      <button
        type="button"
        className="tm-btn tm-btn--primary"
        disabled={asOfMs === null || vault.busy !== null || vault.list.status !== "done"}
        onClick={() => asOfMs !== null && vault.create(asOfMs)}
        title="Тэр мөчийн сэргээлтээс өөрчлөгдөхгүй түүхэн snapshot үүсгэж Backup Vault-д хадгална"
      >
        <Camera className="size-4" aria-hidden />
        {vault.busy === "create" ? "Үүсгэж байна…" : "Create Historical Snapshot"}
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <TimeMachinePanel onMomentChange={onMomentChange} busy={busyMachine} actions={actions} />
        <BackupVaultPanel
          list={vault.list}
          selectedId={vault.selectedId}
          onSelect={vault.setSelectedId}
          busy={vault.busy}
          message={vault.message}
          asOfMs={asOfMs}
          onCreate={() => asOfMs !== null && vault.create(asOfMs)}
          onVerify={() => vault.selectedId && vault.verify(vault.selectedId)}
          onRestore={() => vault.selectedId && vault.restore(vault.selectedId)}
        />
      </div>
      <HistoricalStatePanel state={rec.state} />
    </div>
  );
}

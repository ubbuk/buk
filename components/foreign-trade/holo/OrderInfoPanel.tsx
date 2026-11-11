import { Box, ClipboardList, Paperclip, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { FtOrderView } from "@/lib/foreign-trade";
import { formatNumber } from "@/lib/utils";
import { AttachmentList, FilePicker } from "../AttachmentList";
import { HoloPanel } from "./HoloPanel";
import s from "./holo.module.css";

/**
 * "Захиалгын мэдээлэл": the reference's two-part area. Left: the slab illustration, the user's description and the
 * attachments. Right: the material table (name, unit, quantity). Every value is the order's own data.
 */
export function OrderInfoPanel({
  order,
  files,
  onFiles,
  busy,
  onUpload,
}: {
  order: FtOrderView;
  files: File[];
  onFiles: (f: File[]) => void;
  busy: boolean;
  onUpload: () => void;
}) {
  return (
    <HoloPanel id="info" icon={<ClipboardList className="size-6" />} title="Захиалгын мэдээлэл">
      <div className={s.info}>
        <div className={s.infoArt} aria-hidden="true" />
        <div className={s.infoList}>
          {order.purpose && (
            <div className={s.infoRow}>
              <span className={s.infoIcon}>
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0">
                <p className={s.infoLabel}>Хэрэгцээний тайлбар</p>
                <p className={s.infoValue}>{order.purpose}</p>
              </div>
            </div>
          )}
          <div className={s.infoRow} id="attachments">
            <span className={s.infoIcon}>
              <Paperclip className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={s.infoLabel}>Хавсралтууд ({order.attachments.length})</p>
              {order.attachments.length === 0 ? <p className={s.infoValue}>Хавсралт алга</p> : <div className="mt-1.5"><AttachmentList orderId={order.id} items={order.attachments} /></div>}
              {order.access.editOrder && (
                <div className="mt-3 space-y-2">
                  <FilePicker files={files} onChange={onFiles} disabled={busy} />
                  {files.length > 0 && (
                    <Button size="sm" loading={busy} onClick={onUpload}>
                      Хавсаргах
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={s.tableBox}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className="w-12">№</th>
                <th>Материалын нэр</th>
                <th className="whitespace-nowrap sm:w-36">Хэмжих нэгж</th>
                <th className="whitespace-nowrap sm:w-44">Тоо хэмжээ</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="text-center text-text-muted">{i.lineNo}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Box className={s.cubeIcon} size={22} />
                      <div className="min-w-0">
                        <p className="font-bold text-white">{i.name}</p>
                        {i.techSpec && <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-muted">{i.techSpec}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="text-center font-semibold">{i.unit}</td>
                  <td className="text-center">
                    <span className={s.qty}>{formatNumber(i.quantity, 3)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </HoloPanel>
  );
}

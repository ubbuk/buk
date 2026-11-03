import { History } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";

// Intentionally a placeholder: no data is shown here because none can be shown
// truthfully yet. This page documents what the Time Machine will plug into.
export default function TimeMachinePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-text-muted" />
          Time Machine — бэлтгэл шатанд
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4 text-sm text-text-muted">
        <p>
          Time Machine нь систем өнгөрсөн тодорхой мөчид (<span className="text-text">asOf</span>) ямар байдалтай байсныг
          Мониторингтой ижил үзүүлэлтээр харуулна. Энэ хэсэг Мониторингтой нэг эрх, нэг өгөгдлийн давхаргыг хуваалцана.
        </p>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            <span className="text-text">Бэлэн:</span> lib/monitoring/queries.ts-ийн функц бүр <code>asOf</code> параметртэй
            (одоо &quot;одоогийн цаг&quot;-аар дуудагддаг), захиалгын хүлээлтийн хугацаа, үйл ажиллагааны түүх нь audit
            бичлэгээс цаг хугацаагаар тооцогддог.
          </li>
          <li>
            <span className="text-text">Дутуу:</span> захиалгын <em>өмнөх төлөвийг</em> сэргээхэд төлөв өөрчлөгдсөн түүхийн
            хүснэгт (status history) хэрэгтэй. Одоогийн схемд зөвхөн сүүлийн төлөв хадгалагддаг тул таамаглаж харуулахгүй.
          </li>
          <li>
            <span className="text-text">Дараагийн алхам:</span> төлөв өөрчлөлт бүрийг бичдэг нэмэлт хүснэгт (migration) болон
            asOf сонгогч нэмнэ. Одоо байгаа workflow-д өөрчлөлт хийхгүйгээр, зөвхөн нэмэлт бичлэгээр.
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

import Image from "next/image";

/** Хуудасны доод талын үйлдвэрийн зураг: бүтэн өргөн, хоёр захаас нь (мөн дээрээс) бүдгэрнэ */
export function FactoryBanner() {
  const mask = "linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%), linear-gradient(180deg, transparent 0%, #000 45%)";
  return (
    <div aria-hidden className="pointer-events-none -mx-4 mt-6 sm:-mx-6" style={{ WebkitMaskImage: mask, WebkitMaskComposite: "source-in", maskImage: mask, maskComposite: "intersect" }}>
      <Image src="/images/factory.png" alt="" width={1875} height={130} sizes="100vw" className="h-auto w-full opacity-95" />
    </div>
  );
}

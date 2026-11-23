// Pure (no server imports): shared by the admin screen. A department name says WHICH department it is; whether it is a factory
// or an office is the separate "type" field, so a name made of a category word is most likely a mistake.
const CATEGORY_WORD = /(^|[^\p{L}])(үйлдвэр|оффис|factory|office)([^\p{L}]|$)/iu;

/** A warning (never a refusal) when the name contains a category word such as «үйлдвэр» / «оффис». */
export function categoryNameWarning(name: string): string | null {
  return CATEGORY_WORD.test(name.trim()) ? "Нэрэнд «үйлдвэр», «оффис» гэх мэт ангиллын нэр бичсэн байна. Төрлийг «Төрөл» талбараар сонгоно: нэрэнд зөвхөн цехийн нэрийг бич." : null;
}

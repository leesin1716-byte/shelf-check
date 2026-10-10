// 첫 화면: 서버에서 페르소나·카탈로그를 모아 클라이언트 앱에 넘긴다
import { PERSONAS } from "@/lib/fixtures/personas";
import { PRODUCTS } from "@/lib/catalog/products";
import ShelfCheckApp, { type PersonaCard } from "@/components/ShelfCheckApp";

export default function Page() {
  const personas: PersonaCard[] = PERSONAS.map((p) => ({
    id: p.id,
    name: p.name,
    age: p.age,
    moment: p.moment,
    story: p.story,
    shelf: p.shelf,
    cart: p.cart ?? [],
    profile: p.profile,
    hasPrevious: !!p.previousScan,
  }));
  return <ShelfCheckApp personas={personas} catalog={PRODUCTS} />;
}

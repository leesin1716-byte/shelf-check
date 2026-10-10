"use client";
// 제품 카드 한 장(선반·장바구니·구매 추천에서 공용)
import type { Product } from "@/lib/catalog/products";

export default function ProductCard({
  product,
  ribbon,
  note,
  dashed,
}: {
  product: Product;
  ribbon?: string;
  note?: string;
  dashed?: boolean;
}) {
  return (
    <div className={`product${dashed ? " cart" : ""}`}>
      {ribbon && <span className="ribbon">{ribbon}</span>}
      <span className="cat">
        {product.category} · {product.time === "both" ? "AM/PM" : product.time.toUpperCase()}
      </span>
      <span className="nm">
        <span className="brandname">{product.brand}</span> {product.name}
      </span>
      <div className="tags">
        {product.actives.map((a) => (
          <span className="tag" key={a}>
            {a.replace(/_/g, " ")}
          </span>
        ))}
        <span className="tag">${product.priceUsd}</span>
      </div>
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}

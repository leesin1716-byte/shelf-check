// 브라우저가 보낸 시나리오 입력(스캔·선반·장바구니·프로필)을 서버에서 검증하는 zod 스키마
import { z } from "zod";
import { CONCERNS } from "./types";
import { getProduct } from "../catalog/products";

const score = z.object({ raw: z.number().min(0).max(100), ui: z.number().min(0).max(100) });
const concernScore = score.extend({
  maskUrl: z.string().max(2000).optional(),
  regions: z.record(z.string().max(40), score.extend({ maskUrl: z.string().max(2000).optional() })).optional(),
});
const skinType = z.string().max(40).optional();

export const SkinScanSchema = z.object({
  id: z.string().max(80),
  capturedAt: z.string().max(40),
  source: z.enum(["live", "recorded", "sample"]),
  mode: z.enum(["hd", "sd"]),
  overall: z.number().nullable(),
  skinAge: z.number().nullable(),
  skinType: z.object({ whole: skinType, tZone: skinType, uZone: skinType }),
  concerns: z.partialRecord(z.enum(CONCERNS), concernScore),
  baseImageUrl: z.string().max(2000).optional(),
  tone: z
    .object({
      skinHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      lipHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      eyeColorName: z.string().max(20).optional(),
      hairColorName: z.string().max(20).optional(),
    })
    .optional(),
});

const productId = z.string().refine((id) => !!getProduct(id), "Unknown product id");

export const ScenarioInputSchema = z.object({
  moment: z.enum(["pre_purchase", "breakout", "is_it_working"]),
  scan: SkinScanSchema,
  previousScan: SkinScanSchema.optional(),
  shelf: z
    .array(z.object({ productId, startedAt: z.string().max(40).optional() }))
    .max(20)
    .refine((s) => new Set(s.map((x) => x.productId)).size === s.length, "Duplicate shelf items"),
  cart: z.array(productId).max(3).optional(),
  profile: z.object({
    pregnantOrNursing: z.boolean().optional(),
    budgetUsd: z.number().min(0).max(1000).optional(),
    fragranceSensitive: z.boolean().optional(),
  }),
});

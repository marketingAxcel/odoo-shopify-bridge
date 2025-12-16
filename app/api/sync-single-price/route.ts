import { NextRequest } from "next/server";
import { getPricesFromPricelistForSkus } from "@/lib/odooClient";
import {
  getVariantPriceBySku,
  updateVariantPriceBySku,
} from "@/lib/shopifyClient";

const PRICELIST_FULL_ID = 625;

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Falta el parámetro ?sku=",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 1) Precio en Odoo (lista FULL 625)
    const priceLines = await getPricesFromPricelistForSkus(
      PRICELIST_FULL_ID,
      [sku]
    );
    const odooPrice = priceLines.length ? priceLines[0].price : null;

    if (odooPrice == null) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          error: "El SKU no tiene precio en la lista FULL (625)",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2) Precio actual en Shopify
    const oldPrice = await getVariantPriceBySku(sku);

    // 3) Actualizar solo si es distinto
    let newPrice: number | null = null;

    if (oldPrice === null || oldPrice !== odooPrice) {
      await updateVariantPriceBySku(sku, odooPrice);
      newPrice = odooPrice;
    } else {
      newPrice = oldPrice;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sku,
        odoo_price: odooPrice,
        shopify_old_price: oldPrice,
        shopify_new_price: newPrice,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en /api/sync-single-price:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

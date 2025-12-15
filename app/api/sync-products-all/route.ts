// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getOdooStockBySkus,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import { upsertProductFromOdoo } from "@/lib/shopifyClient";

// ID de la lista de precios FULL (PRECIOFULL) desde el .env
// ODOO_PRICELIST_FULL_ID=625
const PRICELIST_FULL_ID = Number(process.env.ODOO_PRICELIST_FULL_ID || "0");

/**
 * Recorre TODO el catálogo de llantas PAY en Odoo
 * y hace upsert en Shopify (crear/actualizar sin duplicar),
 * decidiendo ACTIVE/DRAFT según stock + precio.
 *
 * Uso:
 *   POST /api/sync-products-all
 */
export async function POST(_req: NextRequest) {
  try {
    const PAGE_SIZE = 50;
    let offset = 0;

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      status: "active" | "draft";
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      status: "active" | "draft";
    }> = [];

    const errors: Array<{
      odoo_id: number;
      sku: string;
      message: string;
    }> = [];

    while (true) {
      const odooProducts = await getOdooProductsPage(PAGE_SIZE, offset);
      if (!odooProducts.length) break;

      const skus = odooProducts
        .map((p) => p.default_code)
        .filter((s) => !!s);

      // 1) Stock por SKU
      const stockLines = await getOdooStockBySkus(skus);
      const stockMap = new Map<string, number>();
      for (const line of stockLines) {
        stockMap.set(line.default_code, line.qty_available);
      }

      // 2) Precios por SKU desde PRECIOFULL (si está configurado)
      const priceMap = new Map<string, number>();
      if (PRICELIST_FULL_ID) {
        const priceLines = await getPricesFromPricelistForSkus(
          PRICELIST_FULL_ID,
          skus
        );
        for (const pl of priceLines) {
          priceMap.set(pl.default_code, pl.price);
        }
      }

      // 3) Recorrer productos y decidir status
      for (const p of odooProducts) {
        const sku = p.default_code;
        const qty = stockMap.get(sku) ?? 0;

        // --- PRECIO EFECTIVO ---
        // 1) PRECIOFULL si existe
        // 2) si no, list_price
        let effectivePrice: number | null = null;

        const priceFromFull = priceMap.get(sku);
        if (typeof priceFromFull === "number") {
          effectivePrice = priceFromFull;
        } else if (typeof p.list_price === "number") {
          effectivePrice = p.list_price;
        }

        // Lo consideramos "precio real" solo si es > 1 (ignoramos 0 y 1)
        const hasRealPrice =
          typeof effectivePrice === "number" && effectivePrice > 1;

        // --- LÓGICA DE STATUS ---
        // Si NO tiene precio real (null, 0 o 1) Y qty <= 0 → DRAFT
        // En cualquier otro caso → ACTIVE
        const status: "active" | "draft" =
          !hasRealPrice && qty <= 0 ? "draft" : "active";

        // Para enviar a Shopify usamos el effectivePrice si existe,
        // si no, dejamos el list_price que venga de Odoo
        const productForShopify = {
          ...p,
          list_price: effectivePrice ?? p.list_price ?? 0,
        };

        try {
          const result = await upsertProductFromOdoo(
            productForShopify,
            status
          );

          const baseItem = {
            odoo_id: p.id,
            shopify_product_id: result.product_id,
            sku,
            status,
          };

          if (result.mode === "created") {
            created.push(baseItem);
          } else {
            updated.push(baseItem);
          }
        } catch (err: any) {
          console.error("Error upsert producto Shopify", p.default_code, err);
          errors.push({
            odoo_id: p.id,
            sku: p.default_code,
            message: err?.message || "Error desconocido",
          });
        }
      }

      offset += PAGE_SIZE;
      if (offset > 5000) break; // freno de seguridad
    }

    return new Response(
      JSON.stringify({
        ok: true,
        created_count: created.length,
        updated_count: updated.length,
        created,
        updated,
        errors,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en sync-products-all:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

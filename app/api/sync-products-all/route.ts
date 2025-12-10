// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import { upsertProductFromOdoo } from "@/lib/shopifyClient";

/**
 * Recorre TODO el catálogo de llantas PAY en Odoo
 * y hace upsert en Shopify (crear/actualizar sin duplicar).
 *
 * Uso:
 *   POST /api/sync-products-all
 */
export async function POST(_req: NextRequest) {
  try {
    const PAGE_SIZE = 50; // cuántos va trayendo por iteración
    let offset = 0;

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
    }> = [];

    const errors: Array<{ odoo_id: number; sku: string; message: string }> = [];

    while (true) {
      const odooProducts = await getOdooProductsPage(PAGE_SIZE, offset);

      if (!odooProducts.length) {
        break; // ya no hay más productos en este rango
      }

      for (const p of odooProducts) {
        try {
          const result = await upsertProductFromOdoo(p);

          const baseItem = {
            odoo_id: p.id,
            shopify_product_id: result.product_id,
            sku: p.default_code,
          };

          if (result.mode === "created") {
            created.push(baseItem);
          } else {
            updated.push(baseItem);
          }
        } catch (err: any) {
          console.error(
            "Error upsert producto Shopify",
            p.default_code,
            err
          );
          errors.push({
            odoo_id: p.id,
            sku: p.default_code,
            message: err?.message || "Error desconocido",
          });
        }
      }

      offset += PAGE_SIZE;

      // Freno de seguridad por si acaso
      if (offset > 5000) break;
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

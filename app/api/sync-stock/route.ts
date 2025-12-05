// app/api/sync-stock/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage, getOdooStockBySkus } from "@/lib/odooClient";
import {
  getInventoryItemIdBySku,
  setInventoryLevel,
} from "@/lib/shopifyClient";

/**
 * Sincroniza inventario de llantas PAY desde Odoo hacia Shopify.
 *
 * Usa la misma lógica de paginación que /api/sync-products:
 *  - limit:  cuántos productos PAY traer de Odoo (default 20)
 *  - offset: desde qué índice empezar (default 0)
 *
 * Flujo:
 *  1) Trae llantas PAY desde Odoo (getOdooProductsPage)
 *  2) Saca sus SKUs
 *  3) Pide qty_available desde Odoo (getOdooStockBySkus)
 *  4) Por cada SKU:
 *      - Busca inventory_item_id en Shopify
 *      - Llama a inventory_levels/set con ese qty_available
 *
 * Ejemplo:
 *  POST /api/sync-stock?limit=20&offset=0
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || "20");
    const offset = Number(searchParams.get("offset") || "0");

    // 1) Llantas PAY de Odoo en este bloque
    const odooProducts = await getOdooProductsPage(limit, offset);
    const skus = odooProducts.map((p) => p.default_code);

    if (!skus.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "No hay productos PAY en este rango",
          processed_skus: 0,
          updated: 0,
          errors: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2) Stock por SKU desde Odoo
    const stockLines = await getOdooStockBySkus(skus);

    let updated = 0;
    const errors: Array<{ sku: string; message: string }> = [];

    // 3) Actualizar inventario en Shopify para cada SKU
    for (const line of stockLines) {
      try {
        const inventoryItemId = await getInventoryItemIdBySku(
          line.default_code
        );

        if (!inventoryItemId) {
          errors.push({
            sku: line.default_code,
            message:
              "No se encontró variante en Shopify para este SKU (¿no se ha sincronizado el producto?)",
          });
          continue;
        }

        await setInventoryLevel(inventoryItemId, line.qty_available);
        updated++;
      } catch (err: any) {
        console.error(
          "Error actualizando inventario",
          line.default_code,
          err
        );
        errors.push({
          sku: line.default_code,
          message: err?.message || "Error desconocido",
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed_skus: skus.length,
        updated,
        errors,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en sync-stock:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

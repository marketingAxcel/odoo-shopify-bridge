// app/api/sync-stock/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage, getOdooStockBySkus } from "@/lib/odooClient";
import {
  getInventoryItemIdBySku,
  setInventoryLevel,
} from "@/lib/shopifyClient";

/**
 * Sincroniza inventario de llantas PAY desde Odoo hacia Shopify.
 * Además, devuelve por cada SKU:
 *  - cuánto stock tenía Odoo
 *  - qué respondió Shopify (available, location_id, etc.)
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
          details: [],
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
    const details: Array<{
      sku: string;
      odoo_qty: number;
      inventory_item_id: number | null;
      shopify_available: number | null;
      location_id: number | null;
      error?: string;
    }> = [];

    // 3) Actualizar inventario en Shopify para cada SKU
    for (const line of stockLines) {
      const detail: any = {
        sku: line.default_code,
        odoo_qty: line.qty_available,
        inventory_item_id: null,
        shopify_available: null,
        location_id: null,
      };

      try {
        const inventoryItemId = await getInventoryItemIdBySku(
          line.default_code
        );

        if (!inventoryItemId) {
          detail.error =
            "No se encontró variante en Shopify para este SKU (¿no se ha sincronizado el producto?)";
          details.push(detail);
          continue;
        }

        detail.inventory_item_id = inventoryItemId;

        const level = await setInventoryLevel(
          inventoryItemId,
          line.qty_available
        );

        // level debería traer { available, location_id, inventory_item_id, ... }
        detail.shopify_available =
          typeof level?.available === "number" ? level.available : null;
        detail.location_id =
          typeof level?.location_id === "number" ? level.location_id : null;

        updated++;
      } catch (err: any) {
        console.error(
          "Error actualizando inventario",
          line.default_code,
          err
        );
        detail.error = err?.message || "Error desconocido";
      }

      details.push(detail);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed_skus: skus.length,
        updated,
        details,
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

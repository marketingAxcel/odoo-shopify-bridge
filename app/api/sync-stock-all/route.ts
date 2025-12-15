// app/api/sync-stock-all/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage, getOdooStockBySkus } from "@/lib/odooClient";
import {
  getAllInventoryItemsBySku,
  setInventoryLevel,
} from "@/lib/shopifyClient";

// pequeño helper para pausar un ratico entre llamadas a Shopify
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recorre TODAS las llantas PAY en Odoo
 * y sincroniza su inventario hacia Shopify.
 *
 * Uso:
 *   POST /api/sync-stock-all
 */
export async function POST(_req: NextRequest) {
  try {
    const PAGE_SIZE = 50;
    let offset = 0;

    let processedSkus = 0;
    let updated = 0;
    const details: Array<{
      sku: string;
      odoo_qty: number;
      inventory_item_id: number | null;
      shopify_available: number | null;
      location_id: number | null;
      error?: string;
    }> = [];

    // 🔹 1) Cargar SOLO una vez todos los SKUs de Shopify
    //     para evitar miles de requests
    const skuToInventoryItem: Record<string, number> =
      await getAllInventoryItemsBySku();

    // 🔹 2) Paginamos productos en Odoo
    while (true) {
      const odooProducts = await getOdooProductsPage(PAGE_SIZE, offset);
      if (!odooProducts.length) break;

      const skus = odooProducts.map((p) => p.default_code);
      processedSkus += skus.length;

      // Stock desde Odoo para esos SKUs
      const stockLines = await getOdooStockBySkus(skus);

      // 🔹 3) Actualizar inventario en Shopify
      for (const line of stockLines) {
        const detail: any = {
          sku: line.default_code,
          odoo_qty: line.qty_available,
          inventory_item_id: null,
          shopify_available: null,
          location_id: null,
        };

        try {
          const inventoryItemId = skuToInventoryItem[line.default_code];

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

          detail.shopify_available =
            typeof level?.available === "number" ? level.available : null;
          detail.location_id =
            typeof level?.location_id === "number" ? level.location_id : null;

          updated++;

          // 😴 Ritmo tranqui: pequeña pausa para no saturar a Shopify
          await sleep(120); // 120 ms entre updates aprox
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

      offset += PAGE_SIZE;
      if (offset > 5000) break; // freno de seguridad
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed_skus: processedSkus,
        updated,
        details,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en sync-stock-all:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

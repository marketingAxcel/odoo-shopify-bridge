import { NextRequest } from "next/server";
import { getOdooStockBySkus } from "@/lib/odooClient";
import {
  getInventoryItemIdBySku,
  setInventoryLevel,
} from "@/lib/shopifyClient";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Falta el parámetro 'sku' en la query (?sku=...)",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stockLines = await getOdooStockBySkus([sku]);

    if (!stockLines.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          error:
            "No se encontró producto en Odoo con ese SKU (default_code).",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const line = stockLines[0];

    const detail: {
      sku: string;
      odoo_qty: number;
      inventory_item_id: number | null;
      shopify_available: number | null;
      location_id: number | null;
      error?: string;
    } = {
      sku: line.default_code,
      odoo_qty: line.qty_available,
      inventory_item_id: null,
      shopify_available: null,
      location_id: null,
    };

    try {
      const inventoryItemId = await getInventoryItemIdBySku(line.default_code);

      if (!inventoryItemId) {
        detail.error =
          "No se encontró variante en Shopify para este SKU (¿ya se sincronizó el producto?).";
      } else {
        detail.inventory_item_id = inventoryItemId;

        const level = await setInventoryLevel(inventoryItemId, line.qty_available);

        detail.shopify_available =
          typeof level?.available === "number" ? level.available : null;
        detail.location_id =
          typeof level?.location_id === "number" ? level.location_id : null;
      }
    } catch (err: any) {
      console.error("Error actualizando inventario para SKU", sku, err);
      detail.error = err?.message || "Error desconocido al actualizar Shopify";
    }

    const updated =
      detail.shopify_available === detail.odoo_qty &&
      detail.inventory_item_id !== null &&
      !detail.error
        ? 1
        : 0;

    return new Response(
      JSON.stringify({
        ok: true,
        processed_skus: 1,
        updated,
        details: [detail],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error en /api/sync-stock:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

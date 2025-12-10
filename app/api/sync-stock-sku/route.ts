import { NextRequest } from "next/server";
import { getOdooStockBySkus } from "@/lib/odooClient";
import {
  getInventoryItemIdBySku,
  setInventoryLevel,
} from "@/lib/shopifyClient";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";

    if (!sku) {
      return new Response(
        JSON.stringify({ error: "Falta parámetro ?sku=PAYXXX" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1) Stock de Odoo para ese SKU
    const stockLines = await getOdooStockBySkus([sku]);
    if (!stockLines.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          message: "SKU no encontrado en Odoo",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const line = stockLines[0];

    // 2) Variante en Shopify
    const inventoryItemId = await getInventoryItemIdBySku(sku);
    if (!inventoryItemId) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          odoo_qty: line.qty_available,
          message:
            "No se encontró variante en Shopify para este SKU (¿ya corriste /api/sync-products?)",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3) Actualizar inventario en Shopify
    const level = await setInventoryLevel(inventoryItemId, line.qty_available);

    return new Response(
      JSON.stringify({
        ok: true,
        sku,
        odoo_qty: line.qty_available,
        inventory_item_id: inventoryItemId,
        shopify_available: level?.available ?? null,
        location_id: level?.location_id ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error en sync-stock-sku:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

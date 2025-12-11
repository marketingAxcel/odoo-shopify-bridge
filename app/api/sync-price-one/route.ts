import { NextRequest } from "next/server";
import { getPricesFromPricelistForSkus } from "@/lib/odooClient";
import { updateVariantPriceBySku } from "@/lib/shopifyClient";

const PRICELIST_FULL_ID = Number(process.env.ODOO_PRICELIST_FULL_ID || "0");

export async function POST(req: NextRequest) {
  try {
    if (!PRICELIST_FULL_ID) {
      throw new Error("Falta ODOO_PRICELIST_FULL_ID en las variables de entorno");
    }

    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";

    if (!sku) {
      return new Response(
        JSON.stringify({ error: "Falta el parámetro ?sku=PAYXXX" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1) Obtener precio desde Odoo (lista PRECIOFULL + list_price)
    const prices = await getPricesFromPricelistForSkus(PRICELIST_FULL_ID, [sku]);

    if (!prices.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          message: "No se encontró precio en Odoo (ni lista ni list_price)",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const odooPrice = prices[0].price;

    // 2) Actualizar precio en Shopify
    const variant = await updateVariantPriceBySku(sku, odooPrice);

    if (!variant) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          odoo_price: odooPrice,
          message: "SKU no encontrado en Shopify",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sku,
        odoo_price: odooPrice,
        shopify_variant_id: variant.id,
        new_shopify_price: variant.price,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error en /api/sync-price-one:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

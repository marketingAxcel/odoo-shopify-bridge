// app/api/debug-sku/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import { getVariantsBySku } from "@/lib/shopifyClient";

/**
 * Busca un producto en Odoo recorriendo las páginas
 * que ya usamos en getOdooProductsPage.
 */
async function findOdooProductBySku(sku: string) {
  const PAGE_SIZE = 200;
  let offset = 0;
  const cleanSku = sku.trim();

  while (true) {
    const prods = await getOdooProductsPage(PAGE_SIZE, offset);
    if (!prods.length) break;

    const found = prods.find((p: any) =>
      String(p.default_code || "").trim() === cleanSku
    );

    if (found) return found;

    offset += PAGE_SIZE;
    if (offset > 20000) break; // freno de seguridad
  }

  return null;
}

/**
 * GET /api/debug-sku?sku=PAY115
 *
 * Devuelve info del SKU en Odoo y en Shopify para ver de dónde sale.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Falta el parámetro ?sku=PAYXXX",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const cleanSku = sku.trim();

    // Shopify: variantes con ese SKU
    const shopifyVariants = await getVariantsBySku(cleanSku);

    // Odoo: producto con ese default_code
    const odooProduct = await findOdooProductBySku(cleanSku);

    return new Response(
      JSON.stringify(
        {
          ok: true,
          sku: cleanSku,
          shopify: shopifyVariants.map((v: any) => ({
            product_id: v.product_id,
            variant_id: v.id,
            inventory_item_id: v.inventory_item_id,
          })),
          odoo: odooProduct
            ? {
                id: odooProduct.id,
                name: odooProduct.name,
                default_code: odooProduct.default_code,
                list_price: odooProduct.list_price,
              }
            : null,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en /api/debug-sku:", err);
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

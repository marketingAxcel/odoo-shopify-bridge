import { NextRequest } from "next/server";
import { findProductsBySku, getOdooStockBySkus } from "@/lib/odooClient";
import {
  getVariantsBySku,
  getVariantPriceBySku,
  updateVariantPriceBySku,
} from "@/lib/shopifyClient";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const skuParam = searchParams.get("sku");

    if (!skuParam) {
      return new Response(
        JSON.stringify({ ok: false, error: "Falta el parámetro 'sku'" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const sku = skuParam.trim();

    const [odooProducts, odooStockLines] = await Promise.all([
      findProductsBySku([sku]),
      getOdooStockBySkus([sku]),
    ]);

    const odooProduct = odooProducts[0] ?? null;
    const odooStock = odooStockLines[0] ?? null;

    if (!odooProduct) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          error: "SKU no existe en Odoo",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const odooPrice =
      typeof odooProduct.list_price === "number"
        ? odooProduct.list_price
        : null;

    if (odooPrice === null) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          error: "El producto en Odoo no tiene list_price",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const variants = await getVariantsBySku(sku);

    if (!variants.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          sku,
          odoo: {
            id: odooProduct.id,
            name: odooProduct.name,
            list_price: odooPrice,
            qty_available: odooStock?.qty_available ?? null,
          },
          error: "SKU no existe en Shopify",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const variant = variants[0];
    const beforePrice = await getVariantPriceBySku(sku);

    const updatedVariant = await updateVariantPriceBySku(sku, odooPrice);
    const afterPrice =
      updatedVariant && updatedVariant.price != null
        ? Number(updatedVariant.price)
        : await getVariantPriceBySku(sku);

    const delta =
      beforePrice != null && afterPrice != null
        ? afterPrice - beforePrice
        : null;

    const body = {
      ok: true,
      sku,
      odoo: {
        id: odooProduct.id,
        name: odooProduct.name,
        list_price: odooPrice,
        qty_available: odooStock?.qty_available ?? null,
      },
      shopify_before: {
        product_id: variant.product_id,
        variant_id: variant.id,
        inventory_item_id: variant.inventory_item_id,
        price: beforePrice,
      },
      shopify_after: {
        product_id: variant.product_id,
        variant_id: variant.id,
        inventory_item_id: variant.inventory_item_id,
        price: afterPrice,
      },
      diff: {
        price_before: beforePrice,
        price_after: afterPrice,
        delta,
      },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno en sync-single-price",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

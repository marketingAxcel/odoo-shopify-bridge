// app/api/sync-both/route.ts
import { NextRequest } from "next/server";

/**
 * Orquesta:
 *  - /api/sync-stock-all      → sincroniza inventario de todas las llantas
 *  - /api/sync-prices-all     → sincroniza precios de todas las llantas
 *  - /api/sync-products-all   → sincroniza productos (paginado 50 en 50)
 *
 * Lo usan tus 4 crons externos en cron-job.org
 *   POST https://odoo-shopify-bridge.vercel.app/api/sync-both
 */
export async function POST(_req: NextRequest) {
  try {
    // Base URL (en Vercel usa VERCEL_URL, en local usa localhost)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // 1) STOCK
    const stockRes = await fetch(`${baseUrl}/api/sync-stock-all`, {
      method: "POST",
    });

    const stockJson = await stockRes.json().catch(() => null);

    // 2) PRECIOS
    const pricesRes = await fetch(`${baseUrl}/api/sync-prices-all`, {
      method: "POST",
    });

    const pricesJson = await pricesRes.json().catch(() => null);

    // 3) PRODUCTOS (paginado)
    const limit = 50;
    let offset = 0;
    const productBatches: any[] = [];

    while (true) {
      const url = `${baseUrl}/api/sync-products-all?limit=${limit}&offset=${offset}`;

      const res = await fetch(url, { method: "POST" });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `sync-products-all falló en offset=${offset}: ${res.status} ${text}`
        );
      }

      const json = await res.json().catch(() => null);
      productBatches.push(json);

      const nextOffset = json?.next_offset;

      // Si no hay siguiente página, terminamos
      if (nextOffset == null) {
        break;
      }

      offset = nextOffset;

      // Freno de seguridad por si acaso
      if (offset > 5000) break;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stock_status: stockRes.status,
        prices_status: pricesRes.status,
        stock_body: stockJson,
        prices_body: pricesJson,
        product_batches: productBatches,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error interno en /api/sync-both:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno en sync-both",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

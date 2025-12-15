// app/api/sync-both/route.ts
import { NextRequest } from "next/server";

/**
 * Ruta “maestra”:
 * 1) Sincroniza stock
 * 2) Sincroniza precios
 * 3) Recorre TODOS los productos en batches (paginado) y hace upsert
 *
 * Uso:
 *   POST /api/sync-both
 */
export async function POST(_req: NextRequest) {
  try {
    // 🟢 IMPORTANTE:
    // En producción usamos SIEMPRE el dominio público (sin protección SSO)
    // En local usamos localhost
    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://odoo-shopify-bridge.vercel.app"
        : "http://localhost:3000";

    // 1) Stock
    const stockRes = await fetch(`${baseUrl}/api/sync-stock-all`, {
      method: "POST",
    });
    const stockJson = await stockRes.json().catch(() => null);

    if (!stockRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          step: "stock",
          status: stockRes.status,
          body: stockJson,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2) Precios
    const pricesRes = await fetch(`${baseUrl}/api/sync-prices-all`, {
      method: "POST",
    });
    const pricesJson = await pricesRes.json().catch(() => null);

    if (!pricesRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          step: "prices",
          status: pricesRes.status,
          body: pricesJson,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 3) Productos en batches (paginado)
    const LIMIT = 50;
    let offset = 0;
    const productBatches: any[] = [];

    while (true) {
      const url = `${baseUrl}/api/sync-products-all?limit=${LIMIT}&offset=${offset}`;
      const res = await fetch(url, { method: "POST" });

      const json: any = await res.json().catch(() => null);

      if (!res.ok) {
        const snippet =
          typeof json === "string"
            ? json.slice(0, 400)
            : JSON.stringify(json).slice(0, 400);

        throw new Error(
          `sync-products-all falló en offset=${offset}: ${res.status} ${snippet}`
        );
      }

      productBatches.push(json);

      const nextOffset = json?.next_offset;
      if (nextOffset == null) break; // ya no hay más páginas

      offset = nextOffset;
      if (offset > 5000) break; // freno de seguridad
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stock: stockJson,
        prices: pricesJson,
        product_batches: productBatches,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en /api/sync-both:", err);
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

// app/api/sync-both/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Base URL del deployment en Vercel
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    // Ejecutar stock y precios en cadena
    const stockRes = await fetch(`${baseUrl}/api/sync-stock-all`, {
      method: "POST",
    });

    const pricesRes = await fetch(`${baseUrl}/api/sync-prices-all`, {
      method: "POST",
    });

    const stockJson = await stockRes.json().catch(() => null);
    const pricesJson = await pricesRes.json().catch(() => null);

    return NextResponse.json(
      {
        ok: true,
        stock_status: stockRes.status,
        prices_status: pricesRes.status,
        stock_body: stockJson,
        prices_body: pricesJson,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error en /api/sync-both:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Error interno en sync-both",
      },
      { status: 500 }
    );
  }
}
